import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImagePreprocessorService } from '../ml/image-preprocessor.service';
import { ObjectDetectionService } from '../ml/object-detection.service';
import { DetectionResult } from './interfaces/detection-result.interface';
import { AppConfig } from '../config/app.config';

const BAG_CLASSES = new Set(['paper_bags', 'plastic_bags']);
const RECEIPT_CLASS = 'receipts';

@Injectable()
export class AnalyzerService {
  private readonly scoreThreshold: number;

  constructor(
    private readonly preprocessor: ImagePreprocessorService,
    private readonly detector: ObjectDetectionService,
    configService: ConfigService,
  ) {
    const config = configService.get<AppConfig>('app');
    this.scoreThreshold = config?.bagConfidenceThreshold ?? 0.4;
  }

  async analyze(rawBuffer: Buffer): Promise<DetectionResult> {
    const [{ buffer }, blurScore] = await Promise.all([
      this.preprocessor.process(rawBuffer),
      this.preprocessor.computeBlurScore(rawBuffer),
    ]);

    const detections = await this.detector.detect(buffer, this.scoreThreshold);

    const bags = detections.filter((d) => BAG_CLASSES.has(d.class));
    const receipts = detections.filter((d) => d.class === RECEIPT_CLASS);

    const bagScore = parseFloat(
      bags.reduce((max, d) => Math.max(max, d.score), 0).toFixed(4),
    );
    const receiptScore = parseFloat(
      receipts.reduce((max, d) => Math.max(max, d.score), 0).toFixed(4),
    );

    const hasBag = bags.length > 0;
    const hasReceipt = receipts.length > 0;

    return {
      hasBag,
      hasReceipt,
      hasBagWithReceipt: hasBag && hasReceipt,
      bagScore,
      receiptScore,
      blurScore,
    };
  }
}
