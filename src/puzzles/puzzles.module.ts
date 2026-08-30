import { Module } from '@nestjs/common';
import { PuzzlesController } from './puzzles.controller';
import { PuzzlesService } from './puzzles.service';
import { PrismaService } from '../prisma/prisma.service';
import { PuzzleBattleGateway } from './puzzle-battle.gateway';
import { PuzzleBattleService } from './puzzle-battle.service';

@Module({
  controllers: [PuzzlesController],
  providers: [PuzzlesService, PrismaService, PuzzleBattleGateway, PuzzleBattleService],
})
export class PuzzlesModule {}
