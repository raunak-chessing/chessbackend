import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReadService } from '../prisma/prisma-read.service';
import { Prisma, TournamentStatus, TournamentType, GameWinner } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisService } from '../redis/redis.service';
import { SwissPairingService } from './swiss-pairing.service';
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

@Injectable()
export class TournamentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TournamentsService.name);
  private eventSubscriber: ReturnType<RedisService['getClient']> | null = null;

  constructor(
    private prisma: PrismaService,
    private prismaRead: PrismaReadService,
    private redisService: RedisService,
    private swissPairingService: SwissPairingService,
  ) {}

  onModuleInit() {
    this.listenForGameEndEvents();
  }

  onModuleDestroy() {
    this.eventSubscriber?.disconnect();
  }

  private listenForGameEndEvents() {
    this.eventSubscriber = this.redisService.getClient().duplicate();
    this.eventSubscriber.subscribe('gameserver:events', (err) => {
      if (err) this.logger.error('Failed to subscribe to gameserver events', err);
    });

    this.eventSubscriber.on('message', async (channel, message) => {
      if (channel !== 'gameserver:events') return;
      try {
        const event = JSON.parse(message);
        if (event.type === 'game_ended' && event.gameId) {
          await this.handleGameEnded(event.gameId, event.winner ?? null);
        }
      } catch (e) {
        this.logger.error('Error processing game_ended event for tournament result recording', e as Error);
      }
    });
  }

  private async handleGameEnded(gameId: string, winner: GameWinner | null) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { tournamentId: true, whitePlayerId: true, blackPlayerId: true },
    });
    if (!game?.tournamentId || !game.blackPlayerId) return;

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: game.tournamentId },
    });
    if (!tournament) return;

    await this.recordGameResult(game.tournamentId, game.whitePlayerId, game.blackPlayerId, winner);

    if (tournament.type === TournamentType.SWISS) {
      await this.prisma.tournamentPairing.updateMany({
        where: { gameId },
        data: { result: winner ?? 'DRAW' },
      });
      await this.maybeAdvanceSwissRound(game.tournamentId);
    }
  }

  async createArena(
    name: string,
    timeControl: string,
    startTime: Date,
    durationMinutes: number,
  ) {
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
    return this.prisma.tournament.create({
      data: {
        name,
        type: TournamentType.ARENA,
        timeControl,
        startTime,
        endTime,
        status: TournamentStatus.UPCOMING,
      },
    });
  }

  async createSwiss(
    name: string,
    timeControl: string,
    maxRounds: number,
    startTime: Date,
  ) {
    return this.prisma.tournament.create({
      data: {
        name,
        type: TournamentType.SWISS,
        timeControl,
        startTime,
        maxRounds,
        status: TournamentStatus.UPCOMING,
      },
    });
  }

  async getStandings(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    // Read-heavy, refresh-tolerant: served from the read replica when one is
    // configured (DATABASE_REPLICA_URL), the primary otherwise.
    return this.prismaRead.tournamentPlayer.findMany({
      where: { tournamentId },
      orderBy: [{ score: 'desc' }, { streak: 'desc' }],
      include: { user: { select: { id: true, name: true, rating: true } } },
    });
  }

  async getPairingsForRound(tournamentId: string, roundNumber: number) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Tournament not found');

    return this.prisma.tournamentPairing.findMany({
      where: { tournamentId, roundNumber },
      include: {
        whitePlayer: { select: { id: true, name: true, rating: true } },
        blackPlayer: { select: { id: true, name: true, rating: true } },
      },
    });
  }

  async startNextRound(tournamentId: string) {
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
          await this.awardWin(tx, tournamentId, pairing.whitePlayerId);
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

  private async awardWin(tx: Prisma.TransactionClient, tournamentId: string, userId: string) {
    const player = await tx.tournamentPlayer.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (!player) return;

    const newStreak = player.streak + 1;
    const scoreDelta = newStreak >= 3 ? 4 : 2;
    await tx.tournamentPlayer.update({
      where: { id: player.id },
      data: { score: { increment: scoreDelta }, streak: newStreak },
    });
  }

  private async maybeAdvanceSwissRound(tournamentId: string) {
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

  private async completeSwissTournament(tournamentId: string) {
    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: TournamentStatus.COMPLETED, endTime: new Date() },
    });

    await this.prisma.$executeRaw`
      UPDATE "TournamentPlayer" tp
      SET rank = sub.rn
      FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) as rn FROM "TournamentPlayer" WHERE "tournamentId" = ${tournamentId}) sub
      WHERE tp.id = sub.id
    `;
  }

  async listTournaments() {
    return this.prisma.tournament.findMany({
      orderBy: { startTime: 'desc' },
      take: 20,
    });
  }

  async getTournament(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        players: {
          include: {
            user: { select: { id: true, name: true, rating: true } },
          },
          orderBy: { score: 'desc' },
        },
        rounds: {
          select: { roundNumber: true, startedAt: true, completedAt: true },
          orderBy: { roundNumber: 'desc' },
        },
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    return tournament;
  }

  async joinTournament(userId: string, tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.status === TournamentStatus.COMPLETED)
      throw new BadRequestException('Tournament is already completed');

    const existing = await this.prisma.tournamentPlayer.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (existing) return existing;

    return this.prisma.tournamentPlayer.create({
      data: { userId, tournamentId },
    });
  }

  async recordGameResult(
    tournamentId: string,
    whitePlayerId: string,
    blackPlayerId: string,
    winner: GameWinner | null,
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament || tournament.status !== TournamentStatus.IN_PROGRESS)
      return;


    const updatePlayer = async (
      userId: string,
      isWinner: boolean,
      isDraw: boolean,
    ) => {
      const player = await this.prisma.tournamentPlayer.findUnique({
        where: { userId_tournamentId: { userId, tournamentId } },
      });
      if (!player) return;

      let scoreDelta = 0;
      let newStreak = isWinner ? player.streak + 1 : 0;

      if (isWinner) {
        scoreDelta = newStreak >= 3 ? 4 : 2;
      } else if (isDraw) {
        scoreDelta = 1;
        newStreak = 0;
      }

      await this.prisma.tournamentPlayer.update({
        where: { id: player.id },
        data: {
          score: { increment: scoreDelta },
          streak: newStreak,
        },
      });
    };

    if (winner === GameWinner.DRAW) {
      await updatePlayer(whitePlayerId, false, true);
      await updatePlayer(blackPlayerId, false, true);
    } else if (winner === GameWinner.WHITE) {
      await updatePlayer(whitePlayerId, true, false);
      await updatePlayer(blackPlayerId, false, false);
    } else if (winner === GameWinner.BLACK) {
      await updatePlayer(whitePlayerId, false, false);
      await updatePlayer(blackPlayerId, true, false);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTournamentStatus() {
    const now = new Date();


    const upcoming = await this.prisma.tournament.findMany({
      where: { status: TournamentStatus.UPCOMING, startTime: { lte: now } },
    });
    for (const t of upcoming) {
      await this.prisma.tournament.update({
        where: { id: t.id },
        data: { status: TournamentStatus.IN_PROGRESS },
      });
      this.logger.log(`Tournament started: ${t.id}`);

      if (t.type === TournamentType.SWISS) {
        await this.startNextRound(t.id).catch((e) =>
          this.logger.error(`Failed to start round 1 for Swiss tournament ${t.id}`, e),
        );
      }
    }


    const inProgress = await this.prisma.tournament.findMany({
      where: {
        status: TournamentStatus.IN_PROGRESS,
        endTime: { lte: now },
        type: TournamentType.ARENA,
      },
    });
    for (const t of inProgress) {
      await this.prisma.tournament.update({
        where: { id: t.id },
        data: { status: TournamentStatus.COMPLETED },
      });
      this.logger.log(`Tournament ended: ${t.id}`);


      await this.prisma.$executeRaw`
        UPDATE "TournamentPlayer" tp
        SET rank = sub.rn
        FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) as rn FROM "TournamentPlayer" WHERE "tournamentId" = ${t.id}) sub
        WHERE tp.id = sub.id
      `;
    }
  }
}
