import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '../../config/app.config';

@Injectable()
export class SecretKeyGuard implements CanActivate {
  private readonly secretKey: string | null;

  constructor(configService: ConfigService) {
    const config = configService.get<AppConfig>('app');
    this.secretKey = config?.secretKey ?? null;
  }

  canActivate(context: ExecutionContext): boolean {
    // Only enforce when a key is configured
    if (!this.secretKey) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-secret-key'];

    if (provided !== this.secretKey) {
      throw new UnauthorizedException('Invalid or missing X-Secret-Key header');
    }

    return true;
  }
}
