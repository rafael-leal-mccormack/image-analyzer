import { Module } from '@nestjs/common';
import { AnalyzerController } from './analyzer.controller';
import { AnalyzerService } from './analyzer.service';
import { SecretKeyGuard } from '../common/guards/secret-key.guard';

@Module({
  controllers: [AnalyzerController],
  providers: [AnalyzerService, SecretKeyGuard],
})
export class AnalyzerModule {}
