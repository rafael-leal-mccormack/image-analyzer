import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as sharp from 'sharp';

const MAX_DIMENSION = 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Laplacian kernel — measures edge response; high stdev = sharp, low stdev = blurry.
// offset=128 keeps output in 0-255 range without clamping negative values to 0.
const LAPLACIAN_KERNEL = {
  width: 3,
  height: 3,
  kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
  scale: 1,
  offset: 128,
};

// Blur is measured by dividing a normalised copy of the image into a GRID×GRID
// grid of patches and taking the MAX Laplacian stdev across all patches.
// A blurry image has uniformly low stdev in every patch.
// A sharp image with a plain bag in the centre still has high-stdev patches
// in the background or receipt area.
// Normalising to a fixed size first ensures extract() always gets exact pixel
// coordinates — relying on metadata() from the original buffer (especially webp)
// can return wrong dimensions and cause all patches to silently process the full image.
const BLUR_GRID = 3;
const BLUR_ANALYSIS_SIZE = 300; // normalise to this before patch extraction
const BLUR_PATCH_SIZE = Math.floor(BLUR_ANALYSIS_SIZE / BLUR_GRID); // 100px

// Max patch stdev at or above this value is considered fully sharp (blurScore → 0).
// Calibrated from observed max stdev range 18–45 across all test images:
//   blurry-order.webp → 18.2, good images → 31–36, sharp no-order JPEGs → 44.5
const SHARP_STDEV_THRESHOLD = 45;

export interface PreprocessedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

@Injectable()
export class ImagePreprocessorService {
  private readonly logger = new Logger(ImagePreprocessorService.name);

  async process(input: Buffer): Promise<PreprocessedImage> {
    const rotated = sharp(input).rotate(); // auto-rotate via EXIF

    const metadata = await rotated.metadata();

    if (!metadata.format) {
      throw new BadRequestException('Unable to determine image format');
    }

    const mimeType = `image/${metadata.format}`;
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(
        `Unsupported image format: ${metadata.format}. Accepted: jpeg, png, webp`,
      );
    }

    let image = rotated;
    const origWidth = metadata.width ?? 0;
    const origHeight = metadata.height ?? 0;

    if (origWidth > MAX_DIMENSION || origHeight > MAX_DIMENSION) {
      image = image.resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const { data, info } = await image
      .removeAlpha()
      .jpeg()
      .toBuffer({ resolveWithObject: true });

    return { buffer: data, width: info.width, height: info.height };
  }

  async computeBlurScore(input: Buffer): Promise<number> {
    // Apply Laplacian to the full normalised image once, then get raw pixels.
    // Computing patch stats from the raw buffer directly avoids sharp's extract()
    // which was returning identical stdevs across all patches regardless of content.
    const { data } = await sharp(input)
      .rotate()
      .resize(BLUR_ANALYSIS_SIZE, BLUR_ANALYSIS_SIZE, { fit: 'fill' })
      .grayscale()
      .convolve(LAPLACIAN_KERNEL)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const stdevs = this.patchStdevs(data, BLUR_ANALYSIS_SIZE, BLUR_ANALYSIS_SIZE, BLUR_GRID);
    const maxStdev = Math.max(...stdevs);
    const score = Math.max(0, 1 - maxStdev / SHARP_STDEV_THRESHOLD);

    this.logger.debug(`blurScore=${score.toFixed(4)} maxStdev=${maxStdev.toFixed(1)}`);

    return parseFloat(score.toFixed(4));
  }

  private patchStdevs(
    pixels: Buffer,
    width: number,
    height: number,
    grid: number,
  ): number[] {
    const patchW = Math.floor(width / grid);
    const patchH = Math.floor(height / grid);
    const stdevs: number[] = [];

    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        let sum = 0;
        let count = 0;
        for (let y = row * patchH; y < (row + 1) * patchH; y++) {
          for (let x = col * patchW; x < (col + 1) * patchW; x++) {
            sum += pixels[y * width + x];
            count++;
          }
        }
        const mean = sum / count;
        let variance = 0;
        for (let y = row * patchH; y < (row + 1) * patchH; y++) {
          for (let x = col * patchW; x < (col + 1) * patchW; x++) {
            const diff = pixels[y * width + x] - mean;
            variance += diff * diff;
          }
        }
        stdevs.push(Math.sqrt(variance / count));
      }
    }

    return stdevs;
  }
}
