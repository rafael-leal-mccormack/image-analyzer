import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from '../src/app.module';
import { ModelLoaderService } from '../src/ml/model-loader.service';

const IMAGES_DIR = path.resolve(__dirname, '..', 'public', 'images');
const MODEL_LOAD_TIMEOUT_MS = 90_000;

function img(filename: string): Buffer {
  return fs.readFileSync(path.join(IMAGES_DIR, filename));
}

interface AnalyzeResponse {
  hasBagWithReceipt: boolean;
  bagScore: number;
  receiptScore: number;
  blurScore: number;
}

function expectValidShape(body: AnalyzeResponse): void {
  expect(typeof body.hasBagWithReceipt).toBe('boolean');
  expect(body.bagScore).toBeGreaterThanOrEqual(0);
  expect(body.bagScore).toBeLessThanOrEqual(1);
  expect(body.receiptScore).toBeGreaterThanOrEqual(0);
  expect(body.receiptScore).toBeLessThanOrEqual(1);
  expect(body.blurScore).toBeGreaterThanOrEqual(0);
  expect(body.blurScore).toBeLessThanOrEqual(1);
}

async function analyze(app: INestApplication, filename: string): Promise<AnalyzeResponse> {
  const ext = filename.split('.').pop()!.toLowerCase();
  const contentType =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
    : 'image/webp';

  const res = await request(app.getHttpServer())
    .post('/api/v1/analyze')
    .attach('image', img(filename), { filename, contentType })
    .expect(200);

  expectValidShape(res.body);
  return res.body;
}

describe('POST /api/v1/analyze', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(ThrottlerModule)
      .useModule(ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]))
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const modelLoader = app.get(ModelLoaderService);
    const deadline = Date.now() + MODEL_LOAD_TIMEOUT_MS;
    while (!modelLoader.isReady()) {
      if (Date.now() > deadline) {
        throw new Error(`ML model did not load within ${MODEL_LOAD_TIMEOUT_MS}ms`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }, MODEL_LOAD_TIMEOUT_MS + 10_000);

  afterAll(async () => {
    await app.close();
  });

  // ── Input validation ───────────────────────────────────────────────────────

  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/analyze')
      .expect(400);
    expect(res.body).toMatchObject({ statusCode: 400 });
  });

  it('returns 400 for an unsupported file type', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/analyze')
      .attach('image', Buffer.from('not an image'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    expect(res.body).toMatchObject({ statusCode: 400 });
  });

  // ── Shape check across all fixtures ───────────────────────────────────────

  it('returns a valid response shape for every test image', async () => {
    const files = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f));

    const results = await Promise.all(files.map((f) => analyze(app, f)));
    expect(results).toHaveLength(files.length);
  });

  // ── No bag/receipt in scene ────────────────────────────────────────────────

  describe('images with no order', () => {
    it('no_order_in_image.jpeg — nothing detected, sharpest image in set', async () => {
      const body = await analyze(app, 'no_order_in_image.jpeg');
      expect(body.hasBagWithReceipt).toBe(false);
      expect(body.bagScore).toBe(0);
      expect(body.receiptScore).toBe(0);
      expect(body.blurScore).toBeLessThan(0.05); // max patch stdev ~44.5, blurScore ~0.011
    });

    it('no_order_in_image_2.jpeg — nothing detected, sharp image', async () => {
      const body = await analyze(app, 'no_order_in_image_2.jpeg');
      expect(body.hasBagWithReceipt).toBe(false);
      expect(body.bagScore).toBe(0);
      expect(body.receiptScore).toBe(0);
      expect(body.blurScore).toBeLessThan(0.25); // max patch stdev ~36.3, blurScore ~0.194
    });
  });

  // ── Bag visible but receipt not detected ──────────────────────────────────

  describe('images where only one class is detected', () => {
    it('good_quality_weird_placement.jpeg — bag detected, receipt missing from frame', async () => {
      const body = await analyze(app, 'good_quality_weird_placement.jpeg');
      expect(body.hasBagWithReceipt).toBe(false);
      expect(body.bagScore).toBeGreaterThan(0.6);  // bag clearly visible (0.7658)
      expect(body.receiptScore).toBe(0);
      expect(body.blurScore).toBeLessThan(0.35);   // max stdev ~32.5, blurScore ~0.277
    });

    it('good_image_quality_bad_angle.jpeg — receipt detected, bag not visible from angle', async () => {
      const body = await analyze(app, 'good_image_quality_bad_angle.jpeg');
      expect(body.hasBagWithReceipt).toBe(false);
      expect(body.bagScore).toBe(0);
      expect(body.receiptScore).toBeGreaterThan(0.6); // receipt clearly visible (0.7345)
      expect(body.blurScore).toBeLessThan(0.25);       // max stdev ~36.3, blurScore ~0.194
    });

    it('ok_angle_clover_order.webp — bag present, receipt below threshold', async () => {
      const body = await analyze(app, 'ok_angle_clover_order.webp');
      expect(body.hasBagWithReceipt).toBe(false);
      expect(body.bagScore).toBeGreaterThan(0.25); // detected above confidence threshold (0.3617)
      expect(body.receiptScore).toBe(0);
      expect(body.blurScore).toBeLessThan(0.45);   // max stdev ~28.2, blurScore ~0.373
    });

    it('blurry-order.webp — bag present, receipt not detected, highest blurScore in set', async () => {
      const body = await analyze(app, 'blurry-order.webp');
      expect(body.hasBagWithReceipt).toBe(false);
      expect(body.bagScore).toBeGreaterThan(0.4); // 0.5569
      expect(body.receiptScore).toBe(0);
      expect(body.blurScore).toBeGreaterThan(0.5); // clearly blurry — max stdev ~18.2, blurScore ~0.595
    });
  });

  // ── Both bag and receipt detected ─────────────────────────────────────────

  describe('images with bag and receipt both in frame', () => {
    it('good_quality_good_placement_busy_background.jpeg — clear detection despite busy background', async () => {
      const body = await analyze(app, 'good_quality_good_placement_busy_background.jpeg');
      expect(body.hasBagWithReceipt).toBe(true);
      expect(body.bagScore).toBeGreaterThan(0.3);    // 0.4258
      expect(body.receiptScore).toBeGreaterThan(0.4); // 0.5722
      expect(body.blurScore).toBeLessThan(0.40);      // max stdev ~31.5, blurScore ~0.300
    });

    it('ok_image_thats_cut_off.jpeg — detected even when partially cut off', async () => {
      const body = await analyze(app, 'ok_image_thats_cut_off.jpeg');
      expect(body.hasBagWithReceipt).toBe(true);
      expect(body.bagScore).toBeGreaterThan(0.2);    // low but above threshold (0.2642)
      expect(body.receiptScore).toBeGreaterThan(0.7); // high confidence (0.8359)
      expect(body.blurScore).toBeLessThan(0.15);      // max stdev ~40.4, blurScore ~0.102
    });

    it('good_photo_with_originally_low_score.jpg — detected despite historically low score', async () => {
      const body = await analyze(app, 'good_photo_with_originally_low_score.jpg');
      expect(body.hasBagWithReceipt).toBe(true);
      expect(body.bagScore).toBeGreaterThan(0.2);    // 0.2853
      expect(body.receiptScore).toBeGreaterThan(0.8); // very high (0.8995)
      expect(body.blurScore).toBeLessThan(0.55);      // max stdev ~23.6, blurScore ~0.476 (borderline quality)
    });

    it('good_photo_clover_order.webp — clover order correctly identified', async () => {
      const body = await analyze(app, 'good_photo_clover_order.webp');
      expect(body.hasBagWithReceipt).toBe(true);
      expect(body.bagScore).toBeGreaterThan(0.2);    // 0.264
      expect(body.receiptScore).toBeGreaterThan(0.3); // 0.4294
      expect(body.blurScore).toBeLessThan(0.35);      // max stdev ~32.8, blurScore ~0.272
    });

    it('good-quality-with-second-order-in-view.webp — high receipt confidence', async () => {
      const body = await analyze(app, 'good-quality-with-second-order-in-view.webp');
      expect(body.hasBagWithReceipt).toBe(true);
      expect(body.bagScore).toBeGreaterThan(0.25);   // 0.3385
      expect(body.receiptScore).toBeGreaterThan(0.7); // very high (0.8915)
      expect(body.blurScore).toBeLessThan(0.30);      // max stdev ~35.4, blurScore ~0.215
    });

    it('good-quality-with-second-order-to-side.webp — bag and receipt visible from side angle', async () => {
      const body = await analyze(app, 'good-quality-with-second-order-to-side.webp');
      expect(body.hasBagWithReceipt).toBe(true);
      expect(body.bagScore).toBeGreaterThan(0.5);    // strong bag detection (0.6286)
      expect(body.receiptScore).toBeGreaterThan(0.6); // 0.7766
      expect(body.blurScore).toBeLessThan(0.35);      // max stdev ~33.2, blurScore ~0.262
    });

    it('bad-angle-and-second-order-to-side.webp — detected despite bad angle', async () => {
      const body = await analyze(app, 'bad-angle-and-second-order-to-side.webp');
      expect(body.hasBagWithReceipt).toBe(true);
      expect(body.bagScore).toBeGreaterThan(0.4);    // 0.5008
      expect(body.receiptScore).toBeGreaterThan(0.4); // 0.5814
      expect(body.blurScore).toBeLessThan(0.45);      // max stdev ~28.6, blurScore ~0.364
    });
  });

  // ── Blur scoring ───────────────────────────────────────────────────────────

  describe('blurScore calibration', () => {
    it('blurry-order.webp has the highest blurScore in the set', async () => {
      const [blurry, sharp1, sharp2] = await Promise.all([
        analyze(app, 'blurry-order.webp'),                     // 0.595
        analyze(app, 'ok_image_thats_cut_off.jpeg'),           // 0.102
        analyze(app, 'good-quality-with-second-order-in-view.webp'), // 0.215
      ]);
      expect(blurry.blurScore).toBeGreaterThan(sharp1.blurScore);
      expect(blurry.blurScore).toBeGreaterThan(sharp2.blurScore);
    });

    it('no_order_in_image.jpeg has the lowest blurScore in the set', async () => {
      const [sharpest, blurry, mid] = await Promise.all([
        analyze(app, 'no_order_in_image.jpeg'),   // 0.011
        analyze(app, 'blurry-order.webp'),         // 0.595
        analyze(app, 'bad-angle-and-second-order-to-side.webp'), // 0.364
      ]);
      expect(sharpest.blurScore).toBeLessThan(blurry.blurScore);
      expect(sharpest.blurScore).toBeLessThan(mid.blurScore);
    });
  });
});
