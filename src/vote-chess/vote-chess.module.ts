import { Module } from '@nestjs/common';
import { VoteChessService } from './vote-chess.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [VoteChessService],
  exports: [VoteChessService],
})
export class VoteChessModule {}
