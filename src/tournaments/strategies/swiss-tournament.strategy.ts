import { Injectable } from '@nestjs/common';
import { TournamentType, GameWinner } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SwissRoundService } from '../swiss-round.service';
import { TournamentTypeStrategy } from './tournament-type-strategy.interface';

@Injectable()
export class SwissTournamentStrategy implements TournamentTypeStrategy {
  readonly type = TournamentType.SWISS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly swissRoundService: SwissRoundService,
  ) {}

  async onStarted(tournamentId: string): Promise<void> {
    await this.swissRoundService.startNextRound(tournamentId);
  }

  async onGameEnded(tournamentId: string, gameId: string, winner: GameWinner | null): Promise<void> {
    await this.prisma.tournamentPairing.updateMany({
      where: { gameId },
      data: { result: winner ?? 'DRAW' },
    });
    await this.swissRoundService.maybeAdvanceSwissRound(tournamentId);
  }
}
