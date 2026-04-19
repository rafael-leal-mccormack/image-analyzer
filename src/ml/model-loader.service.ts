import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as tf from '@tensorflow/tfjs-node';
import * as path from 'path';

const MODEL_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'models',
  'bag_detection',
  'model.json',
);

@Injectable()
export class ModelLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ModelLoaderService.name);
  private model: tf.GraphModel | null = null;
  private ready = false;

  async onModuleInit(): Promise<void> {
    await this.loadWithRetry(3);
  }

  private async loadWithRetry(maxAttempts: number): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.log(
          `Loading bag detection model (attempt ${attempt}/${maxAttempts})...`,
        );
        this.model = await tf.loadGraphModel(`file://${MODEL_PATH}`);
        this.ready = true;
        this.logger.log('Model loaded successfully');
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to load model: ${message}`);
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.log(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    this.logger.error(
      'All model load attempts failed. Service will return 503 until restart.',
    );
  }

  isReady(): boolean {
    return this.ready;
  }

  getModel(): tf.GraphModel {
    if (!this.model) {
      throw new Error('Model not loaded');
    }
    return this.model;
  }
}
