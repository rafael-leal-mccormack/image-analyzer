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

// stdev at or above this value is considered fully sharp (blurScore → 0).
// Tune this based on observed raw stdev values logged per request.
const SHARP_STDEV_THRESHOLD = 100;

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
    const stats = await sharp(input)
      .rotate()
      .grayscale()
      .convolve(LAPLACIAN_KERNEL)
      .stats();

    const stdev = stats.channels[0].stdev;
    const score = Math.max(0, 1 - stdev / SHARP_STDEV_THRESHOLD);

    this.logger.debug(`Laplacian stdev=${stdev.toFixed(2)}, blurScore=${score.toFixed(4)} (threshold=${SHARP_STDEV_THRESHOLD})`);

    return parseFloat(score.toFixed(4));
  }
}
