import { DetectedObject } from './detected-object.interface';

export interface ModelProvider {
  readonly name: string;
  isReady(): boolean;
  detect(imageBuffer: Buffer): Promise<DetectedObject[]>;
}
