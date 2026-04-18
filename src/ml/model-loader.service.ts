import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-cpu';
import * as fs from 'fs';
import * as path from 'path';

const MODEL_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'models',
  'bag_detection',
);

function buildFileIOHandler(modelDir: string): tf.io.IOHandler {
  return {
    load: async (): Promise<tf.io.ModelArtifacts> => {
      const modelJsonPath = path.join(modelDir, 'model.json');
      const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

      const weightsManifest: tf.io.WeightsManifestConfig =
        modelJson.weightsManifest ?? [];

      const weightBuffers: ArrayBuffer[] = [];
      for (const group of weightsManifest) {
        for (const shardPath of group.paths) {
          const buf = fs.readFileSync(path.join(modelDir, shardPath));
          weightBuffers.push(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        }
      }

      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs: weightsManifest.flatMap((g) => g.weights),
        weightData: weightBuffers.length === 1
          ? weightBuffers[0]
          : concatenateArrayBuffers(weightBuffers),
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
        signature: modelJson.signature,
      };
    },
  };
}

function concatenateArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer;
}

@Injectable()
export class ModelLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ModelLoaderService.name);
  private model: tf.GraphModel | null = null;
  private ready = false;

  async onModuleInit(): Promise<void> {
    tf.enableProdMode();
    await tf.ready();
    await this.loadWithRetry(3);
  }

  private async loadWithRetry(maxAttempts: number): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.log(
          `Loading bag detection model (attempt ${attempt}/${maxAttempts})...`,
        );
        this.model = await tf.loadGraphModel(buildFileIOHandler(MODEL_DIR));
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
