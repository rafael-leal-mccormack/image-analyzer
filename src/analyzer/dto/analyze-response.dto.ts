import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeResponseDto {
  @ApiProperty({ description: 'Whether the image contains a bag with a receipt' })
  hasBagWithReceipt: boolean;

  @ApiProperty({ description: 'Best detection score for bag classes (paper_bags, plastic_bags), 0 if none detected', minimum: 0, maximum: 1 })
  bagScore: number;

  @ApiProperty({ description: 'Best detection score for receipts, 0 if none detected', minimum: 0, maximum: 1 })
  receiptScore: number;

  @ApiProperty({ description: 'Image blurriness score (0 = sharp, 1 = very blurry), computed via Laplacian variance', minimum: 0, maximum: 1 })
  blurScore: number;
}
