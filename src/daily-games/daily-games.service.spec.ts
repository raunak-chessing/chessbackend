import { Test, TestingModule } from '@nestjs/testing';
import { DailyGamesService } from './daily-games.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { GameStatus, GameWinner } from '@prisma/client';

describe('DailyGamesService', () => {
  let service: DailyGamesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DailyGamesService, getPrismaMockProvider()],
    }).compile();

    service = module.get<DailyGamesService>(DailyGamesService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleTimeouts', () => {
    it('should update timed out games and assign winner', async () => {
      prismaMock.game.findMany.mockResolvedValueOnce([
        { id: 'g1', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' } // white's turn -> black wins
      ] as any);

      await service.handleTimeouts();

      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: expect.objectContaining({
          status: GameStatus.COMPLETED,
          winner: GameWinner.BLACK,
          isTimeout: true
        })
      });
    });

    it('should assign white winner if black timed out', async () => {
      prismaMock.game.findMany.mockResolvedValueOnce([
        { id: 'g1', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1' } // black's turn -> white wins
      ] as any);

      await service.handleTimeouts();

      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: expect.objectContaining({
          winner: GameWinner.WHITE,
        })
      });
    });
  });

  describe('createDailyGame', () => {
    it('should create a daily game', async () => {
      prismaMock.game.create.mockResolvedValueOnce({ id: 'g1' } as any);
      const res = await service.createDailyGame('w1', 'b1', 3);

      expect(prismaMock.game.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            whitePlayerId: 'w1',
            blackPlayerId: 'b1',
            daysPerMove: 3,
            gameType: 'DAILY'
          })
        })
      );
      expect(res).toEqual({ id: 'g1' });
    });
  });

  describe('getMyDailyGames', () => {
    it('should return games for user', async () => {
      prismaMock.game.findMany.mockResolvedValueOnce([{ id: 'g1' }] as any);
      const res = await service.getMyDailyGames('u1');

      expect(prismaMock.game.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: [{ whitePlayerId: 'u1' }, { blackPlayerId: 'u1' }] })
        })
      );
      expect(res).toEqual([{ id: 'g1' }]);
    });
  });

  describe('getGameById', () => {
    it('should throw NotFoundException if game not found', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce(null);
      await expect(service.getGameById('g1')).rejects.toThrow(NotFoundException);
    });

    it('should return game if found', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ id: 'g1' } as any);
      const res = await service.getGameById('g1');
      expect(res).toEqual({ id: 'g1' });
    });
  });

  describe('makeMove', () => {
    const initFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    it('should throw NotFoundException if game not found', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce(null);
      await expect(service.makeMove('u1', 'g1', 'e2', 'e4')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if game is completed', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ status: 'COMPLETED' } as any);
      await expect(service.makeMove('u1', 'g1', 'e2', 'e4')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if wrong user (white turn)', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({
        id: 'g1', fen: initFen, status: 'IN_PROGRESS', whitePlayerId: 'u1', blackPlayerId: 'u2'
      } as any);
      await expect(service.makeMove('u2', 'g1', 'e2', 'e4')).rejects.toThrow('Not your turn');
    });

    it('should throw BadRequestException if wrong user (black turn)', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({
        id: 'g1', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        status: 'IN_PROGRESS', whitePlayerId: 'u1', blackPlayerId: 'u2'
      } as any);
      await expect(service.makeMove('u1', 'g1', 'e7', 'e5')).rejects.toThrow('Not your turn');
    });

    it('should throw BadRequestException if illegal move', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({
        id: 'g1', fen: initFen, status: 'IN_PROGRESS', whitePlayerId: 'u1'
      } as any);
      await expect(service.makeMove('u1', 'g1', 'e2', 'e5')).rejects.toThrow('Illegal move');
    });

    it('should make valid move and update fen/status', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({
        id: 'g1', fen: initFen, status: 'IN_PROGRESS', whitePlayerId: 'u1', daysPerMove: 3
      } as any);
      prismaMock.game.update.mockResolvedValueOnce({ id: 'g1' } as any);

      await service.makeMove('u1', 'g1', 'e2', 'e4');

      expect(prismaMock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'IN_PROGRESS',
            fen: expect.stringContaining('4P3'),
          })
        })
      );
    });

    it('should handle checkmate', async () => {
      // Fen where black can play Qh4#
      const preMateFen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
      prismaMock.game.findUnique.mockResolvedValueOnce({
        id: 'g1', fen: preMateFen, status: 'IN_PROGRESS', whitePlayerId: 'u1', blackPlayerId: 'u2'
      } as any);
      prismaMock.game.update.mockResolvedValueOnce({ id: 'g1' } as any);

      await service.makeMove('u2', 'g1', 'd8', 'h4');

      expect(prismaMock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETED',
            winner: GameWinner.BLACK,
          })
        })
      );
    });

    it('should handle draws', async () => {
      const drawFen = 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1'; 
      prismaMock.game.findUnique.mockResolvedValueOnce({
        id: 'g1', fen: drawFen, status: 'IN_PROGRESS', whitePlayerId: 'u1', blackPlayerId: 'u2'
      } as any);
      prismaMock.game.update.mockResolvedValueOnce({ id: 'g1' } as any);
      
      await service.makeMove('u1', 'g1', 'c5', 'c7'); // Qc7 is stalemate!
      
      expect(prismaMock.game.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETED',
            winner: GameWinner.DRAW,
          })
        })
      );
    });
  });
});
