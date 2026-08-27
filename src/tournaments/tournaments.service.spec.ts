import { Test, TestingModule } from '@nestjs/testing';
import { TournamentsService } from './tournaments.service';
import { SwissPairingService } from './swiss-pairing.service';
import { getPrismaMockProvider, prismaMock, getPrismaReadMockProvider, prismaReadMock } from '../test/mocks/prisma.mock';
import { getRedisMockProvider } from '../test/mocks/redis.mock';
import { NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { TournamentStatus, TournamentType, GameWinner } from '@prisma/client';

describe('TournamentsService', () => {
  let service: TournamentsService;
  let swissPairingService: SwissPairingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentsService,
        SwissPairingService,
        getPrismaMockProvider(),
        getPrismaReadMockProvider(),
        getRedisMockProvider(),
      ],
    }).compile();

    service = module.get<TournamentsService>(TournamentsService);
    swissPairingService = module.get<SwissPairingService>(SwissPairingService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
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
        }
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

  describe('recordGameResult', () => {
    it('should do nothing if tournament not found or not in progress', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce(null);
      await service.recordGameResult('t1', 'w1', 'b1', GameWinner.WHITE);
      expect(prismaMock.tournamentPlayer.findUnique).not.toHaveBeenCalled();

      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.UPCOMING } as any);
      await service.recordGameResult('t1', 'w1', 'b1', GameWinner.WHITE);
      expect(prismaMock.tournamentPlayer.findUnique).not.toHaveBeenCalled();
    });

    it('should handle draw', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.IN_PROGRESS } as any);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValue({ id: 'p1', streak: 2 } as any);
      prismaMock.tournamentPlayer.update.mockResolvedValue({} as any);

      await service.recordGameResult('t1', 'w1', 'b1', GameWinner.DRAW);

      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { score: { increment: 1 }, streak: 0 } })
      );
    });

    it('should handle white win', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.IN_PROGRESS } as any);
      // White player (streak 2 -> 3, gets 4 points)
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'pw', streak: 2 } as any);
      // Black player (streak 1 -> 0, gets 0 points)
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'pb', streak: 1 } as any);
      prismaMock.tournamentPlayer.update.mockResolvedValue({} as any);

      await service.recordGameResult('t1', 'w1', 'b1', GameWinner.WHITE);

      // White update
      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pw' }, data: { score: { increment: 4 }, streak: 3 } })
      );
      // Black update
      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pb' }, data: { score: { increment: 0 }, streak: 0 } })
      );
    });

    it('should handle black win', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.IN_PROGRESS } as any);
      // White player
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'pw', streak: 1 } as any);
      // Black player (streak 0 -> 1, gets 2 points)
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'pb', streak: 0 } as any);
      prismaMock.tournamentPlayer.update.mockResolvedValue({} as any);

      await service.recordGameResult('t1', 'w1', 'b1', GameWinner.BLACK);

      // White update
      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pw' }, data: { score: { increment: 0 }, streak: 0 } })
      );
      // Black update
      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pb' }, data: { score: { increment: 2 }, streak: 1 } })
      );
    });
    
    it('should handle player not found gracefully', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.IN_PROGRESS } as any);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce(null);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce(null);

      await service.recordGameResult('t1', 'w1', 'b1', GameWinner.WHITE);

      expect(prismaMock.tournamentPlayer.update).not.toHaveBeenCalled();
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

  describe('startNextRound', () => {
    it('should throw NotFoundException if tournament not found', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce(null);
      await expect(service.startNextRound('t1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for a non-Swiss tournament', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ type: TournamentType.ARENA } as any);
      await expect(service.startNextRound('t1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if the tournament is already completed', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({
        type: TournamentType.SWISS,
        status: TournamentStatus.COMPLETED,
      } as any);
      await expect(service.startNextRound('t1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException with fewer than two players', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({
        type: TournamentType.SWISS,
        status: TournamentStatus.IN_PROGRESS,
      } as any);
      prismaMock.tournamentPlayer.findMany.mockResolvedValueOnce([{ userId: 'a', score: 0 }] as any);
      prismaMock.tournamentPairing.findMany.mockResolvedValueOnce([]);
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce(null);

      await expect(service.startNextRound('t1')).rejects.toThrow(BadRequestException);
    });

    it('should complete the tournament instead of pairing once maxRounds is exceeded', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({
        id: 't1',
        type: TournamentType.SWISS,
        status: TournamentStatus.IN_PROGRESS,
        maxRounds: 2,
      } as any);
      prismaMock.tournamentPlayer.findMany.mockResolvedValueOnce([
        { userId: 'a', score: 4 },
        { userId: 'b', score: 2 },
      ] as any);
      prismaMock.tournamentPairing.findMany.mockResolvedValueOnce([]);
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce({ roundNumber: 2 } as any);
      prismaMock.$executeRaw.mockResolvedValueOnce(1 as any);

      await service.startNextRound('t1');

      expect(prismaMock.tournament.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: TournamentStatus.COMPLETED, endTime: expect.any(Date) },
      });
      expect(prismaMock.tournamentRound.create).not.toHaveBeenCalled();
    });

    it('should create a round, a game and a pairing for a paired game', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({
        id: 't1',
        type: TournamentType.SWISS,
        status: TournamentStatus.IN_PROGRESS,
        maxRounds: 5,
        timeControl: '10|0',
      } as any);
      prismaMock.tournamentPlayer.findMany.mockResolvedValueOnce([
        { userId: 'a', score: 2 },
        { userId: 'b', score: 0 },
      ] as any);
      prismaMock.tournamentPairing.findMany.mockResolvedValueOnce([]);
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce(null);
      jest.spyOn(swissPairingService, 'generatePairings').mockReturnValueOnce([
        { whitePlayerId: 'a', blackPlayerId: 'b', isBye: false },
      ]);

      await service.startNextRound('t1');

      expect(prismaMock.tournamentRound.create).toHaveBeenCalledWith({
        data: { tournamentId: 't1', roundNumber: 1 },
      });
      expect(prismaMock.game.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            whitePlayerId: 'a',
            blackPlayerId: 'b',
            tournamentId: 't1',
            gameType: 'RAPID',
            status: 'IN_PROGRESS',
          }),
        }),
      );
      expect(prismaMock.tournamentPairing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tournamentId: 't1', roundNumber: 1, whitePlayerId: 'a', blackPlayerId: 'b' }),
        }),
      );
    });

    it('should record a bye without creating a game and award the bye recipient a win', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({
        id: 't1',
        type: TournamentType.SWISS,
        status: TournamentStatus.IN_PROGRESS,
        maxRounds: 5,
        timeControl: '10|0',
      } as any);
      prismaMock.tournamentPlayer.findMany.mockResolvedValueOnce([
        { userId: 'a', score: 2 },
        { userId: 'b', score: 0 },
      ] as any);
      prismaMock.tournamentPairing.findMany.mockResolvedValueOnce([]);
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce(null);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'pa', streak: 0 } as any);
      jest.spyOn(swissPairingService, 'generatePairings').mockReturnValueOnce([
        { whitePlayerId: 'a', blackPlayerId: null, isBye: true },
      ]);

      await service.startNextRound('t1');

      expect(prismaMock.game.create).not.toHaveBeenCalled();
      expect(prismaMock.tournamentPairing.create).toHaveBeenCalledWith({
        data: { tournamentId: 't1', roundNumber: 1, whitePlayerId: 'a', isBye: true, result: 'WHITE' },
      });
      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith({
        where: { id: 'pa' },
        data: { score: { increment: 2 }, streak: 1 },
      });
    });
  });

  describe('handleGameEnded (private)', () => {
    it('should do nothing if the game has no tournamentId', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ tournamentId: null, whitePlayerId: 'w', blackPlayerId: 'b' } as any);
      await (service as any).handleGameEnded('g1', GameWinner.WHITE);
      expect(prismaMock.tournament.findUnique).not.toHaveBeenCalled();
    });

    it('should record the result and advance Swiss round bookkeeping', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ tournamentId: 't1', whitePlayerId: 'a', blackPlayerId: 'b' } as any);
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1', type: TournamentType.SWISS, status: TournamentStatus.IN_PROGRESS } as any);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValue({ id: 'pa', streak: 0 } as any);
      const advanceSpy = jest.spyOn(service as any, 'maybeAdvanceSwissRound').mockResolvedValueOnce(undefined);

      await (service as any).handleGameEnded('g1', GameWinner.WHITE);

      expect(prismaMock.tournamentPairing.updateMany).toHaveBeenCalledWith({
        where: { gameId: 'g1' },
        data: { result: GameWinner.WHITE },
      });
      expect(advanceSpy).toHaveBeenCalledWith('t1');
    });

    it('should not touch Swiss pairing bookkeeping for an Arena tournament', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ tournamentId: 't1', whitePlayerId: 'a', blackPlayerId: 'b' } as any);
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1', type: TournamentType.ARENA, status: TournamentStatus.IN_PROGRESS } as any);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValue({ id: 'pa', streak: 0 } as any);

      await (service as any).handleGameEnded('g1', GameWinner.WHITE);

      expect(prismaMock.tournamentPairing.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('maybeAdvanceSwissRound (private)', () => {
    it('should do nothing while pairings in the current round are still pending', async () => {
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce({ id: 'r1', roundNumber: 1, completedAt: null } as any);
      prismaMock.tournamentPairing.count.mockResolvedValueOnce(1);

      await (service as any).maybeAdvanceSwissRound('t1');

      expect(prismaMock.tournamentRound.update).not.toHaveBeenCalled();
    });

    it('should complete the tournament once the final round finishes', async () => {
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce({ id: 'r1', roundNumber: 2, completedAt: null } as any);
      prismaMock.tournamentPairing.count.mockResolvedValueOnce(0);
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1', maxRounds: 2 } as any);
      prismaMock.$executeRaw.mockResolvedValueOnce(1 as any);

      await (service as any).maybeAdvanceSwissRound('t1');

      expect(prismaMock.tournamentRound.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { completedAt: expect.any(Date) },
      });
      expect(prismaMock.tournament.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: TournamentStatus.COMPLETED, endTime: expect.any(Date) },
      });
    });

    it('should start the next round when more rounds remain', async () => {
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce({ id: 'r1', roundNumber: 1, completedAt: null } as any);
      prismaMock.tournamentPairing.count.mockResolvedValueOnce(0);
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1', maxRounds: 3 } as any);
      const startNextRoundSpy = jest.spyOn(service, 'startNextRound').mockResolvedValueOnce(undefined);

      await (service as any).maybeAdvanceSwissRound('t1');

      expect(startNextRoundSpy).toHaveBeenCalledWith('t1');
    });
  });

  describe('handleTournamentStatus', () => {
    it('should start upcoming tournaments', async () => {
      prismaMock.tournament.findMany
        .mockResolvedValueOnce([{ id: 't1' }] as any) // upcoming
        .mockResolvedValueOnce([]); // inProgress

      await service.handleTournamentStatus();

      expect(prismaMock.tournament.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: TournamentStatus.IN_PROGRESS }
      });
    });

    it('should start round 1 for a Swiss tournament once it begins', async () => {
      prismaMock.tournament.findMany
        .mockResolvedValueOnce([{ id: 't1', type: TournamentType.SWISS }] as any) // upcoming
        .mockResolvedValueOnce([]); // inProgress

      const startNextRoundSpy = jest.spyOn(service, 'startNextRound').mockResolvedValueOnce(undefined);

      await service.handleTournamentStatus();

      expect(startNextRoundSpy).toHaveBeenCalledWith('t1');
    });

    it('should complete in-progress tournaments and calculate ranks', async () => {
      prismaMock.tournament.findMany
        .mockResolvedValueOnce([]) // upcoming
        .mockResolvedValueOnce([{ id: 't2' }] as any); // inProgress

      prismaMock.$executeRaw.mockResolvedValueOnce(1 as any);

      await service.handleTournamentStatus();

      expect(prismaMock.tournament.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: { status: TournamentStatus.COMPLETED }
      });

      expect(prismaMock.$executeRaw).toHaveBeenCalled();
    });
  });
});
