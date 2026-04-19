export interface DetectionResult {
  hasBag: boolean;
  hasReceipt: boolean;
  hasBagWithReceipt: boolean;
  bagScore: number;
  receiptScore: number;
  blurScore: number;
}
