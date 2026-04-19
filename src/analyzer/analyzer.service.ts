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
  private readonly bagThreshold: number;
  private readonly receiptThreshold: number;

  constructor(
    private readonly preprocessor: ImagePreprocessorService,
    private readonly detector: ObjectDetectionService,
    configService: ConfigService,
  ) {
    const config = configService.get<AppConfig>('app');
    this.bagThreshold = config?.bagConfidenceThreshold ?? 0.25;
    this.receiptThreshold = config?.receiptConfidenceThreshold ?? 0.25;
  }

  async analyze(rawBuffer: Buffer): Promise<DetectionResult> {
    const [{ buffer }, blurScore] = await Promise.all([
      this.preprocessor.process(rawBuffer),
      this.preprocessor.computeBlurScore(rawBuffer),
    ]);

    // Use the lower of the two thresholds so the detector surfaces all candidates;
    // we apply per-class thresholds ourselves below.
    const detectionThreshold = Math.min(this.bagThreshold, this.receiptThreshold);
    const detections = await this.detector.detect(buffer, detectionThreshold);

    const bags = detections.filter(
      (d) => BAG_CLASSES.has(d.class) && d.score >= this.bagThreshold,
    );
    const receipts = detections.filter(
      (d) => d.class === RECEIPT_CLASS && d.score >= this.receiptThreshold,
    );

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
