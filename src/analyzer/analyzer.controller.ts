import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ServiceUnavailableException,
  HttpCode,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { SecretKeyGuard } from '../common/guards/secret-key.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiBadRequestResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { AnalyzerService } from './analyzer.service';
import { ModelLoaderService } from '../ml/model-loader.service';
import { AnalyzeResponseDto } from './dto/analyze-response.dto';
import { AppConfig } from '../config/app.config';

const ALLOWED_MIMETYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@ApiTags('analyzer')
@UseGuards(SecretKeyGuard)
@Controller('analyze')
export class AnalyzerController {
  private readonly logger = new Logger(AnalyzerController.name);
  private readonly maxFileSizeBytes: number;

  constructor(
    private readonly analyzerService: AnalyzerService,
    private readonly modelLoader: ModelLoaderService,
    configService: ConfigService,
  ) {
    const config = configService.get<AppConfig>('app');
    this.maxFileSizeBytes = (config?.maxFileSizeMb ?? 10) * 1024 * 1024;
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Analyze an image for a bag containing a receipt' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Image file (jpeg, png, or webp, max 10 MB)',
        },
      },
    },
  })
  @ApiOkResponse({ type: AnalyzeResponseDto })
  @ApiBadRequestResponse({ description: 'Missing or invalid image file' })
  @ApiServiceUnavailableResponse({ description: 'ML model is still loading' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (120 requests per minute per IP)' })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMETYPES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Unsupported file type: ${file.mimetype}. Accepted: image/jpeg, image/png, image/webp`,
            ),
            false,
          );
        }
      },
    }),
  )
  async analyze(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AnalyzeResponseDto> {
    if (!this.modelLoader.isReady()) {
      throw new ServiceUnavailableException(
        'ML models are still loading, please try again shortly',
      );
    }

    if (!file) {
      throw new BadRequestException('No image file provided in field "image"');
    }

    if (file.size > this.maxFileSizeBytes) {
      throw new BadRequestException(
        `File too large. Maximum size is ${this.maxFileSizeBytes / 1024 / 1024} MB`,
      );
    }

    const start = Date.now();
    const result = await this.analyzerService.analyze(file.buffer);
    const { hasBag, hasReceipt, bagScore, receiptScore, blurScore } = result;

    this.logger.log(
      `${file.originalname} → bag=${hasBag}(${bagScore}) receipt=${hasReceipt}(${receiptScore}) blur=${blurScore} ${Date.now() - start}ms`,
    );

    return result;
  }
}
