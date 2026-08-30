import { Injectable } from '@nestjs/common';
import { CacheService } from '../redis/cache.service';

@Injectable()
export class SocialEventService {
  constructor(private readonly cacheService: CacheService) {}

  async publish(userId: string, event: string, data: unknown) {
    await this.cacheService.publish(
      'social:events',
      JSON.stringify({ userId, event, data }),
    );
  }
}
