import { Test, TestingModule } from '@nestjs/testing';
import { SwissRoundService } from './swiss-round.service';
import { SwissPairingService } from './swiss-pairing.service';
import { TournamentScoringService } from './tournament-scoring.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TournamentStatus, TournamentType } from '@prisma/client';

describe('SwissRoundService', () => {
  let service: SwissRoundService;
  let swissPairingService: SwissPairingService;
  let scoringService: jest.Mocked<Pick<TournamentScoringService, 'awardWin' | 'rankPlayers'>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    scoringService = { awardWin: jest.fn(), rankPlayers: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwissRoundService,
        SwissPairingService,
        getPrismaMockProvider(),
        { provide: TournamentScoringService, useValue: scoringService },
      ],
    }).compile();

    service = module.get<SwissRoundService>(SwissRoundService);
    swissPairingService = module.get<SwissPairingService>(SwissPairingService);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
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

      await service.startNextRound('t1');

      expect(prismaMock.tournament.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: TournamentStatus.COMPLETED, endTime: expect.any(Date) },
      });
      expect(scoringService.rankPlayers).toHaveBeenCalledWith(prismaMock, 't1');
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
      jest.spyOn(swissPairingService, 'generatePairings').mockReturnValueOnce([
        { whitePlayerId: 'a', blackPlayerId: null, isBye: true },
      ]);

      await service.startNextRound('t1');

      expect(prismaMock.game.create).not.toHaveBeenCalled();
      expect(prismaMock.tournamentPairing.create).toHaveBeenCalledWith({
        data: { tournamentId: 't1', roundNumber: 1, whitePlayerId: 'a', isBye: true, result: 'WHITE' },
      });
      expect(scoringService.awardWin).toHaveBeenCalledWith(prismaMock, 't1', 'a');
    });
  });

  describe('maybeAdvanceSwissRound', () => {
    it('should do nothing while pairings in the current round are still pending', async () => {
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce({ id: 'r1', roundNumber: 1, completedAt: null } as any);
      prismaMock.tournamentPairing.count.mockResolvedValueOnce(1);

      await service.maybeAdvanceSwissRound('t1');

      expect(prismaMock.tournamentRound.update).not.toHaveBeenCalled();
    });

    it('should complete the tournament once the final round finishes', async () => {
      prismaMock.tournamentRound.findFirst.mockResolvedValueOnce({ id: 'r1', roundNumber: 2, completedAt: null } as any);
      prismaMock.tournamentPairing.count.mockResolvedValueOnce(0);
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1', maxRounds: 2 } as any);

      await service.maybeAdvanceSwissRound('t1');

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

      await service.maybeAdvanceSwissRound('t1');

      expect(startNextRoundSpy).toHaveBeenCalledWith('t1');
    });
  });
});
