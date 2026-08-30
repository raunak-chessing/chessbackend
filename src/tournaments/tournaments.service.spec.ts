import { Test, TestingModule } from '@nestjs/testing';
import { TournamentsService } from './tournaments.service';
import { getPrismaMockProvider, prismaMock, getPrismaReadMockProvider, prismaReadMock } from '../test/mocks/prisma.mock';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TournamentStatus, TournamentType } from '@prisma/client';

describe('TournamentsService', () => {
  let service: TournamentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [TournamentsService, getPrismaMockProvider(), getPrismaReadMockProvider()],
    }).compile();

    service = module.get<TournamentsService>(TournamentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createArena', () => {
    it('should create an arena tournament', async () => {
      prismaMock.tournament.create.mockResolvedValueOnce({ id: 't1' } as any);

      const startTime = new Date();
      const res = await service.createArena('Arena', 'BULLET', startTime, 60);

      const expectedEndTime = new Date(startTime.getTime() + 60 * 60000);

      expect(prismaMock.tournament.create).toHaveBeenCalledWith({
        data: {
          name: 'Arena',
          type: TournamentType.ARENA,
          timeControl: 'BULLET',
          startTime,
          endTime: expectedEndTime,
          status: TournamentStatus.UPCOMING,
        },
      });
      expect(res).toEqual({ id: 't1' });
    });
  });

  describe('listTournaments', () => {
    it('should return recent tournaments', async () => {
      prismaMock.tournament.findMany.mockResolvedValueOnce([{ id: 't1' }] as any);
      const res = await service.listTournaments();
      expect(prismaMock.tournament.findMany).toHaveBeenCalledWith({
        orderBy: { startTime: 'desc' },
        take: 20,
      });
      expect(res).toEqual([{ id: 't1' }]);
    });
  });

  describe('getTournament', () => {
    it('should throw NotFoundException if not found', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce(null);
      await expect(service.getTournament('t1')).rejects.toThrow(NotFoundException);
    });

    it('should return tournament if found', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1' } as any);
      const res = await service.getTournament('t1');
      expect(res).toEqual({ id: 't1' });
    });
  });

  describe('joinTournament', () => {
    it('should throw NotFoundException if tournament not found', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce(null);
      await expect(service.joinTournament('u1', 't1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if tournament is completed', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.COMPLETED } as any);
      await expect(service.joinTournament('u1', 't1')).rejects.toThrow(BadRequestException);
    });

    it('should return existing player if already joined', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.UPCOMING } as any);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'p1' } as any);

      const res = await service.joinTournament('u1', 't1');
      expect(prismaMock.tournamentPlayer.create).not.toHaveBeenCalled();
      expect(res).toEqual({ id: 'p1' });
    });

    it('should create new tournament player', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.UPCOMING } as any);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce(null);
      prismaMock.tournamentPlayer.create.mockResolvedValueOnce({ id: 'p1' } as any);

      const res = await service.joinTournament('u1', 't1');
      expect(prismaMock.tournamentPlayer.create).toHaveBeenCalledWith({
        data: { userId: 'u1', tournamentId: 't1' },
      });
      expect(res).toEqual({ id: 'p1' });
    });
  });

  describe('getStandings', () => {
    it('should throw NotFoundException if the tournament does not exist', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce(null);
      await expect(service.getStandings('t1')).rejects.toThrow(NotFoundException);
      expect(prismaReadMock.tournamentPlayer.findMany).not.toHaveBeenCalled();
    });

    it('should read standings from the read-replica client, not the primary', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1' } as any);
      prismaReadMock.tournamentPlayer.findMany.mockResolvedValueOnce([{ id: 'p1' }] as any);

      const res = await service.getStandings('t1');

      expect(prismaReadMock.tournamentPlayer.findMany).toHaveBeenCalledWith({
        where: { tournamentId: 't1' },
        orderBy: [{ score: 'desc' }, { streak: 'desc' }],
        include: { user: { select: { id: true, name: true, rating: true } } },
      });
      expect(prismaMock.tournamentPlayer.findMany).not.toHaveBeenCalled();
      expect(res).toEqual([{ id: 'p1' }]);
    });
  });

  describe('getPairingsForRound', () => {
    it('should throw NotFoundException if the tournament does not exist', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce(null);
      await expect(service.getPairingsForRound('t1', 1)).rejects.toThrow(NotFoundException);
    });

    it('should return pairings for the given round', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1' } as any);
      prismaMock.tournamentPairing.findMany.mockResolvedValueOnce([{ id: 'pr1' }] as any);

      const res = await service.getPairingsForRound('t1', 2);

      expect(prismaMock.tournamentPairing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tournamentId: 't1', roundNumber: 2 } }),
      );
      expect(res).toEqual([{ id: 'pr1' }]);
    });
  });

  describe('createSwiss', () => {
    it('should create a Swiss tournament', async () => {
      prismaMock.tournament.create.mockResolvedValueOnce({ id: 't1' } as any);

      const startTime = new Date();
      const res = await service.createSwiss('Swiss', '10|0', 5, startTime);

      expect(prismaMock.tournament.create).toHaveBeenCalledWith({
        data: {
          name: 'Swiss',
          type: TournamentType.SWISS,
          timeControl: '10|0',
          startTime,
          maxRounds: 5,
          status: TournamentStatus.UPCOMING,
        },
      });
      expect(res).toEqual({ id: 't1' });
    });
  });
});
