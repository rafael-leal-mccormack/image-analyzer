import { registerAs } from '@nestjs/config';

export interface AppConfig {
  port: number;
  maxFileSizeMb: number;
  detectionConfidenceThreshold: number;
  bagConfidenceThreshold: number;
}

export default registerAs(
  'app',
  (): AppConfig => ({
    port: parseInt(process.env.PORT ?? '3000', 10),
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '10', 10),
    detectionConfidenceThreshold: parseFloat(
      process.env.DETECTION_CONFIDENCE_THRESHOLD ?? '0.5',
    ),
    bagConfidenceThreshold: parseFloat(
      process.env.BAG_CONFIDENCE_THRESHOLD ?? '0.4',
    ),
  }),
);
