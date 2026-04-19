import { registerAs } from '@nestjs/config';

export interface AppConfig {
  port: number;
  maxFileSizeMb: number;
  bagConfidenceThreshold: number;
  receiptConfidenceThreshold: number;
  secretKey: string | null;
}

export default registerAs(
  'app',
  (): AppConfig => ({
    port: parseInt(process.env.PORT ?? '3000', 10),
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '10', 10),
    bagConfidenceThreshold: parseFloat(
      process.env.BAG_CONFIDENCE_THRESHOLD ?? '0.25',
    ),
    receiptConfidenceThreshold: parseFloat(
      process.env.RECEIPT_CONFIDENCE_THRESHOLD ?? '0.25',
    ),
    secretKey: process.env.API_SECRET_KEY ?? null,
  }),
);
