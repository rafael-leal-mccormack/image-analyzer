import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Suppress deprecation warnings emitted by TensorFlow native addon internals
  const TF_DEPRECATION_CODES = new Set(['DEP0051', 'DEP0044']);
  process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning' && TF_DEPRECATION_CODES.has((warning as NodeJS.ErrnoException).code ?? '')) {
      return;
    }
    console.warn(warning);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', String(reason));
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error.stack);
    process.exit(1);
  });

  app.use(helmet());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Simple Analyzer')
    .setDescription('Detects whether an image contains a bag with a receipt')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app');
  const port = appConfig?.port ?? 3000;

  await app.listen(port);
  logger.log(`Application running on port ${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/docs`);
}

bootstrap();
