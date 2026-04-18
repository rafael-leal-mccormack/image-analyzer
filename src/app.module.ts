import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { MlModule } from './ml/ml.module';
import { AnalyzerModule } from './analyzer/analyzer.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 30,
      },
    ]),
    MlModule,
    AnalyzerModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
