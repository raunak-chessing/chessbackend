import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentStatus, TournamentType } from '@prisma/client';
import { SwissPairingService } from './swiss-pairing.service';
import { TournamentScoringService } from './tournament-scoring.service';
import * as crypto from 'crypto';

const STANDARD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function classifyGameType(timeControl: string): string {
  if (!timeControl) return 'RAPID';
  if (timeControl.toLowerCase().includes('day')) return 'DAILY';

  const [baseStr, incStr] = timeControl.split(/[|+]/);
  const baseMinutes = parseFloat(baseStr);
  const incrementSeconds = parseFloat(incStr) || 0;
  if (isNaN(baseMinutes)) return 'RAPID';

  const totalSeconds = baseMinutes * 60 + 40 * incrementSeconds;
  if (totalSeconds < 180) return 'BULLET';
  if (totalSeconds < 600) return 'BLITZ';
  return 'RAPID';
}

/** Round advancement and completion for Swiss-format tournaments. */
@Injectable()
export class SwissRoundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly swissPairingService: SwissPairingService,
    private readonly scoringService: TournamentScoringService,
  ) {}

  async startNextRound(tournamentId: string): Promise<void> {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.type !== TournamentType.SWISS) {
      throw new BadRequestException('Only Swiss tournaments have rounds');
    }
    if (tournament.status === TournamentStatus.COMPLETED) {
      throw new BadRequestException('Tournament already completed');
    }

    const [players, history, lastRound] = await Promise.all([
      this.prisma.tournamentPlayer.findMany({ where: { tournamentId }, orderBy: { score: 'desc' } }),
      this.prisma.tournamentPairing.findMany({ where: { tournamentId } }),
      this.prisma.tournamentRound.findFirst({ where: { tournamentId }, orderBy: { roundNumber: 'desc' } }),
    ]);

    if (players.length < 2) {
      throw new BadRequestException('Not enough players to start a round');
    }

    const roundNumber = (lastRound?.roundNumber ?? 0) + 1;
    if (tournament.maxRounds && roundNumber > tournament.maxRounds) {
      await this.completeSwissTournament(tournamentId);
      return;
    }

    const pairingResults = this.swissPairingService.generatePairings(
      players.map((p) => ({ userId: p.userId, score: p.score })),
      history.map((h) => ({
        whitePlayerId: h.whitePlayerId,
        blackPlayerId: h.blackPlayerId,
        isBye: h.isBye,
      })),
    );

    const gameType = classifyGameType(tournament.timeControl);
    const [baseStr, incStr] = tournament.timeControl.split(/[|+]/);
    const baseTimeMs = (parseInt(baseStr, 10) || 10) * 60 * 1000;
    const incrementMs = (parseInt(incStr, 10) || 0) * 1000;

    await this.prisma.$transaction(async (tx) => {
      await tx.tournamentRound.create({ data: { tournamentId, roundNumber } });

      for (const pairing of pairingResults) {
        if (pairing.isBye || !pairing.blackPlayerId) {
          await tx.tournamentPairing.create({
            data: {
              tournamentId,
              roundNumber,
              whitePlayerId: pairing.whitePlayerId,
              isBye: true,
              result: 'WHITE',
            },
          });
          await this.scoringService.awardWin(tx, tournamentId, pairing.whitePlayerId);
          continue;
        }

        const gameId = crypto.randomUUID();
        await tx.game.create({
          data: {
            id: gameId,
            whitePlayerId: pairing.whitePlayerId,
            blackPlayerId: pairing.blackPlayerId,
            tournamentId,
            timeControl: tournament.timeControl,
            gameType,
            status: 'IN_PROGRESS',
            fen: STANDARD_START_FEN,
            whiteTimeMs: baseTimeMs,
            blackTimeMs: baseTimeMs,
            incrementMs,
            lastMoveTime: new Date(),
          },
        });
        await tx.tournamentPairing.create({
          data: {
            tournamentId,
            roundNumber,
            whitePlayerId: pairing.whitePlayerId,
            blackPlayerId: pairing.blackPlayerId,
            gameId,
          },
        });
      }

      if (tournament.status !== TournamentStatus.IN_PROGRESS) {
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: TournamentStatus.IN_PROGRESS },
        });
      }
    });
  }

  async maybeAdvanceSwissRound(tournamentId: string): Promise<void> {
    const currentRound = await this.prisma.tournamentRound.findFirst({
      where: { tournamentId },
      orderBy: { roundNumber: 'desc' },
    });
    if (!currentRound || currentRound.completedAt) return;

    const pendingCount = await this.prisma.tournamentPairing.count({
      where: {
        tournamentId,
        roundNumber: currentRound.roundNumber,
        isBye: false,
        result: null,
      },
    });
    if (pendingCount > 0) return;

    await this.prisma.tournamentRound.update({
      where: { id: currentRound.id },
      data: { completedAt: new Date() },
    });

    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) return;

    if (tournament.maxRounds && currentRound.roundNumber >= tournament.maxRounds) {
      await this.completeSwissTournament(tournamentId);
    } else {
      await this.startNextRound(tournamentId);
    }
  }

  async completeSwissTournament(tournamentId: string): Promise<void> {
    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: TournamentStatus.COMPLETED, endTime: new Date() },
    });
    await this.scoringService.rankPlayers(this.prisma, tournamentId);
  }
}
