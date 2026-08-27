import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@AllowAnonymous()
@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    try {
      await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        this.redisService.getClient().ping(),
      ]);
      return { status: 'ready' };
    } catch (err) {
      throw new ServiceUnavailableException('Dependency check failed');
    }
  }
}
