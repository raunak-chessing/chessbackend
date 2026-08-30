import { Injectable } from '@nestjs/common';
import { Prisma, TournamentStatus, GameWinner } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Outcome = 'WIN' | 'DRAW' | 'LOSS';
type Executor = PrismaService | Prisma.TransactionClient;

/**
 * The single source of truth for tournament scoring and ranking.
 *
 * Previously the win/streak/score formula was implemented twice
 * independently — once in TournamentsService.awardWin (for byes), once in
 * an inline closure inside recordGameResult (for played games) — with
 * nothing keeping them in sync. Likewise the rank-recalculation raw SQL was
 * copy-pasted in two call sites. Both now live here, once.
 */
@Injectable()
export class TournamentScoringService {
  constructor(private readonly prisma: PrismaService) {}

  private computeDelta(outcome: Outcome, currentStreak: number): { scoreDelta: number; newStreak: number } {
    if (outcome === 'WIN') {
      const newStreak = currentStreak + 1;
      return { scoreDelta: newStreak >= 3 ? 4 : 2, newStreak };
    }
    if (outcome === 'DRAW') {
      return { scoreDelta: 1, newStreak: 0 };
    }
    return { scoreDelta: 0, newStreak: 0 };
  }

  private async applyResult(
    tx: Executor,
    tournamentId: string,
    userId: string,
    outcome: Outcome,
  ): Promise<void> {
    const player = await tx.tournamentPlayer.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (!player) return;

    const { scoreDelta, newStreak } = this.computeDelta(outcome, player.streak);
    await tx.tournamentPlayer.update({
      where: { id: player.id },
      data: { score: { increment: scoreDelta }, streak: newStreak },
    });
  }

  /** Awards a full win outside of a head-to-head game (e.g. a Swiss bye). */
  async awardWin(tx: Executor, tournamentId: string, userId: string): Promise<void> {
    await this.applyResult(tx, tournamentId, userId, 'WIN');
  }

  /** Records the result of a completed game for both players. */
  async recordGameResult(
    tournamentId: string,
    whitePlayerId: string,
    blackPlayerId: string,
    winner: GameWinner | null,
  ): Promise<void> {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament || tournament.status !== TournamentStatus.IN_PROGRESS) return;

    if (winner === GameWinner.DRAW) {
      await this.applyResult(this.prisma, tournamentId, whitePlayerId, 'DRAW');
      await this.applyResult(this.prisma, tournamentId, blackPlayerId, 'DRAW');
    } else if (winner === GameWinner.WHITE) {
      await this.applyResult(this.prisma, tournamentId, whitePlayerId, 'WIN');
      await this.applyResult(this.prisma, tournamentId, blackPlayerId, 'LOSS');
    } else if (winner === GameWinner.BLACK) {
      await this.applyResult(this.prisma, tournamentId, whitePlayerId, 'LOSS');
      await this.applyResult(this.prisma, tournamentId, blackPlayerId, 'WIN');
    }
  }

  /** Recomputes every player's `rank` field from `score`, descending. */
  async rankPlayers(tx: Executor, tournamentId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "TournamentPlayer" tp
      SET rank = sub.rn
      FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) as rn FROM "TournamentPlayer" WHERE "tournamentId" = ${tournamentId}) sub
      WHERE tp.id = sub.id
    `;
  }
}
