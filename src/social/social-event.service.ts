import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SocialEventService {
  constructor(private readonly redisService: RedisService) {}

  async publish(userId: string, event: string, data: unknown) {
    await this.redisService.getClient().publish(
      'social:events',
      JSON.stringify({ userId, event, data }),
    );
  }
}
