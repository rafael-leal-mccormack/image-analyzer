import { Injectable } from '@nestjs/common';
import * as tf from '@tensorflow/tfjs';
import * as sharp from 'sharp';
import { ModelLoaderService } from './model-loader.service';
import { DetectedObject } from './interfaces/detected-object.interface';

const CLASS_NAMES = ['paper_bags', 'plastic_bags', 'receipts'];
const INPUT_SIZE = 640;
const NMS_IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 50;

@Injectable()
export class ObjectDetectionService {
  constructor(private readonly modelLoader: ModelLoaderService) {}

  async detect(imageBuffer: Buffer, scoreThreshold: number): Promise<DetectedObject[]> {
    const model = this.modelLoader.getModel();

    const { data, info } = await sharp(imageBuffer)
      .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const inputTensor = tf.tidy(() => {
      const pixels = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
      return pixels.div(255.0).expandDims(0) as tf.Tensor4D;
    });

    let rawOutput: tf.Tensor;
    try {
      const out = model.predict(inputTensor) as tf.Tensor | tf.Tensor[];
      rawOutput = Array.isArray(out) ? out[0] : out;
      if (Array.isArray(out)) {
        for (let i = 1; i < out.length; i++) out[i].dispose();
      }
    } finally {
      inputTensor.dispose();
    }

    const detections = await this.postProcess(rawOutput, scoreThreshold);
    rawOutput.dispose();
    return detections;
  }

  private async postProcess(
    predictions: tf.Tensor,
    scoreThreshold: number,
  ): Promise<DetectedObject[]> {
    const numClasses = CLASS_NAMES.length;
    const shape = predictions.shape;

    // Normalize shape to [N, 4+C]
    let working: tf.Tensor2D;
    const toDispose: tf.Tensor[] = [];

    if (shape.length === 3 && shape[0] === 1) {
      if (shape[1] === 4 + numClasses) {
        // [1, 4+C, N] → [1, N, 4+C]
        const t = (predictions as tf.Tensor3D).transpose([0, 2, 1]);
        toDispose.push(t);
        working = t.squeeze([0]) as tf.Tensor2D;
      } else {
        working = (predictions as tf.Tensor3D).squeeze([0]) as tf.Tensor2D;
      }
    } else if (shape.length === 2) {
      working = predictions as tf.Tensor2D;
    } else {
      return [];
    }

    const boxesXywh = working.slice([0, 0], [-1, 4]) as tf.Tensor2D;
    const classScores = working.slice([0, 4], [-1, numClasses]) as tf.Tensor2D;
    const topk = tf.topk(classScores, 1);
    const maxScores = topk.values.squeeze() as tf.Tensor1D;
    const classIndices = topk.indices.squeeze().toInt() as tf.Tensor1D;

    const boxesArr = boxesXywh.arraySync() as number[][];
    const scoresArr = maxScores.arraySync() as number[];
    const classesArr = classIndices.arraySync() as number[];

    // Detect coordinate space (normalized vs 640-space)
    let maxVal = 0;
    for (const b of boxesArr) {
      for (const v of b) if (Number.isFinite(v) && v > maxVal) maxVal = v;
    }
    const isNormalized = maxVal <= 1.5;

    const nmsBoxes: number[][] = [];
    const nmsScores: number[] = [];
    const nmsClasses: number[] = [];

    for (let i = 0; i < boxesArr.length; i++) {
      const score = scoresArr[i];
      if (!Number.isFinite(score) || score < scoreThreshold) continue;

      const [xc, yc, w, h] = boxesArr[i];
      const xcPx = isNormalized ? xc * INPUT_SIZE : xc;
      const ycPx = isNormalized ? yc * INPUT_SIZE : yc;
      const wPx = isNormalized ? w * INPUT_SIZE : w;
      const hPx = isNormalized ? h * INPUT_SIZE : h;

      const x1 = xcPx - wPx / 2;
      const y1 = ycPx - hPx / 2;
      const x2 = xcPx + wPx / 2;
      const y2 = ycPx + hPx / 2;

      nmsBoxes.push([y1, x1, y2, x2]);
      nmsScores.push(score);
      nmsClasses.push(classesArr[i]);
    }

    if (nmsBoxes.length === 0) {
      [boxesXywh, classScores, topk.values, topk.indices, maxScores, classIndices, ...toDispose].forEach((t) => t.dispose());
      return [];
    }

    const boxesTensor = tf.tensor2d(nmsBoxes, [nmsBoxes.length, 4]);
    const scoresTensor = tf.tensor1d(nmsScores);
    const nmsIdx = await tf.image.nonMaxSuppressionAsync(
      boxesTensor,
      scoresTensor,
      Math.min(MAX_DETECTIONS, nmsBoxes.length),
      NMS_IOU_THRESHOLD,
      scoreThreshold,
    );
    const selected = await nmsIdx.array();

    const results: DetectedObject[] = [];
    for (const idx of selected) {
      const [y1, x1, y2, x2] = nmsBoxes[idx];
      const classIdx = nmsClasses[idx];
      if (classIdx >= 0 && classIdx < CLASS_NAMES.length) {
        results.push({
          class: CLASS_NAMES[classIdx],
          score: nmsScores[idx],
          bbox: {
            x: Math.max(0, x1),
            y: Math.max(0, y1),
            width: Math.max(0, x2 - x1),
            height: Math.max(0, y2 - y1),
          },
        });
      }
    }

    [boxesXywh, classScores, topk.values, topk.indices, maxScores, classIndices, boxesTensor, scoresTensor, nmsIdx, ...toDispose].forEach((t) => t.dispose());

    return results;
  }
}
