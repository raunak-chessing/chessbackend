import { Module } from '@nestjs/common';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { SocialGateway } from './social.gateway';
import { WagerService } from './wager.service';

@Module({
  providers: [SocialService, SocialGateway, WagerService],
  controllers: [SocialController],
  exports: [WagerService]
})
export class SocialModule {}
