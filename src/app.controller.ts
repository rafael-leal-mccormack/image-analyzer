import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ModelLoaderService } from './ml/model-loader.service';

class HealthResponseDto {
  @ApiProperty()
  status: string;

  @ApiProperty()
  modelsLoaded: boolean;

  @ApiProperty()
  uptime: number;
}

@SkipThrottle()
@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly modelLoader: ModelLoaderService) {}

  @Get('health')
  @ApiOperation({ summary: 'Service health check' })
  @ApiOkResponse({ type: HealthResponseDto })
  health(): HealthResponseDto {
    return {
      status: 'ok',
      modelsLoaded: this.modelLoader.isReady(),
      uptime: Math.floor(process.uptime()),
    };
  }
}
