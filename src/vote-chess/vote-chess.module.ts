import { Module } from '@nestjs/common';
import { VoteChessService } from './vote-chess.service';
import { VoteChessController } from './vote-chess.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [VoteChessController],
  providers: [VoteChessService],
  exports: [VoteChessService],
})
export class VoteChessModule {}
