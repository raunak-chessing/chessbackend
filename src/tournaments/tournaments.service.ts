import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReadService } from '../prisma/prisma-read.service';
import { TournamentStatus, TournamentType } from '@prisma/client';

/** CRUD and read access for tournaments. Lifecycle, scoring, and Swiss
 * round management live in their own services — see TournamentLifecycleService,
 * TournamentScoringService, TournamentEventListenerService, and SwissRoundService. */
@Injectable()
export class TournamentsService {
  constructor(
    private prisma: PrismaService,
    private prismaRead: PrismaReadService,
  ) {}

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
}
