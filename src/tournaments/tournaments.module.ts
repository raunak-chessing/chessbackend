import { Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { SwissPairingService } from './swiss-pairing.service';

import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [TournamentsController],
  providers: [TournamentsService, SwissPairingService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
