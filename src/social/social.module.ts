import { Module } from '@nestjs/common';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { SocialGateway } from './social.gateway';
import { SocialEventService } from './social-event.service';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { WagerService } from './wager.service';
import { WagerLockService } from './wager-lock.service';
import { WagerController } from './wager.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [SocialService, SocialGateway, SocialEventService, MessagesService, WagerService, WagerLockService],
  controllers: [SocialController, MessagesController, WagerController],
  exports: [SocialService, WagerService]
})
export class SocialModule {}
