import { Test, TestingModule } from '@nestjs/testing';
import { TournamentScoringService } from './tournament-scoring.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { TournamentStatus, GameWinner } from '@prisma/client';

describe('TournamentScoringService', () => {
  let service: TournamentScoringService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [TournamentScoringService, getPrismaMockProvider()],
    }).compile();

    service = module.get<TournamentScoringService>(TournamentScoringService);
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
        expect.objectContaining({ data: { score: { increment: 1 }, streak: 0 } }),
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

      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pw' }, data: { score: { increment: 4 }, streak: 3 } }),
      );
      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pb' }, data: { score: { increment: 0 }, streak: 0 } }),
      );
    });

    it('should handle black win', async () => {
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ status: TournamentStatus.IN_PROGRESS } as any);
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'pw', streak: 1 } as any);
      // Black player (streak 0 -> 1, gets 2 points)
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'pb', streak: 0 } as any);
      prismaMock.tournamentPlayer.update.mockResolvedValue({} as any);

      await service.recordGameResult('t1', 'w1', 'b1', GameWinner.BLACK);

      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pw' }, data: { score: { increment: 0 }, streak: 0 } }),
      );
      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pb' }, data: { score: { increment: 2 }, streak: 1 } }),
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

  describe('awardWin', () => {
    it('applies the same win formula as recordGameResult (single source of truth)', async () => {
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce({ id: 'p1', streak: 2 } as any);

      await service.awardWin(prismaMock as any, 't1', 'u1');

      expect(prismaMock.tournamentPlayer.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { score: { increment: 4 }, streak: 3 },
      });
    });

    it('does nothing if the player is not found', async () => {
      prismaMock.tournamentPlayer.findUnique.mockResolvedValueOnce(null);
      await service.awardWin(prismaMock as any, 't1', 'u1');
      expect(prismaMock.tournamentPlayer.update).not.toHaveBeenCalled();
    });
  });

  describe('rankPlayers', () => {
    it('runs the rank-recalculation query for the given tournament', async () => {
      prismaMock.$executeRaw.mockResolvedValueOnce(1 as any);
      await service.rankPlayers(prismaMock as any, 't1');
      expect(prismaMock.$executeRaw).toHaveBeenCalled();
    });
  });
});
