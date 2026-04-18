import { Global, Module } from '@nestjs/common';
import { ModelLoaderService } from './model-loader.service';
import { ObjectDetectionService } from './object-detection.service';
import { ImagePreprocessorService } from './image-preprocessor.service';

@Global()
@Module({
  providers: [ModelLoaderService, ObjectDetectionService, ImagePreprocessorService],
  exports: [ModelLoaderService, ObjectDetectionService, ImagePreprocessorService],
})
export class MlModule {}
