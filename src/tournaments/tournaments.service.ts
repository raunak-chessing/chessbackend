import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentStatus, TournamentType, GameWinner } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(private prisma: PrismaService) {}

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
