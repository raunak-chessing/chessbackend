import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from './analysis.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { RedisService } from '../redis/redis.service';
import { mockRedisService, mockRedisClient } from '../test/mocks/redis.mock';
import { Logger } from '@nestjs/common';

describe('AnalysisService', () => {
  let service: AnalysisService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        getPrismaMockProvider(),
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    // Mock global fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeGame', () => {
    it('should throw Error if game not found', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce(null);
      await expect(service.analyzeGame('g1')).rejects.toThrow('Game not found');
    });

    it('should return cached analysis from db if available', async () => {
      const mockAnalysis = { whiteAccuracy: 95, blackAccuracy: 90, moves: [] };
      prismaMock.game.findUnique.mockResolvedValueOnce({ analysis: mockAnalysis } as any);

      const res = await service.analyzeGame('g1');
      expect(res).toEqual(mockAnalysis);
      expect(prismaMock.game.update).not.toHaveBeenCalled();
    });

    it('should run analyzePgn and save if no analysis exists', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ id: 'g1', pgn: '1. e4' } as any);
      
      const analyzeSpy = jest.spyOn(service, 'analyzePgn').mockResolvedValueOnce({ whiteAccuracy: 99, blackAccuracy: 99, moves: [] });
      prismaMock.game.update.mockResolvedValueOnce({} as any);

      const res = await service.analyzeGame('g1');

      expect(analyzeSpy).toHaveBeenCalledWith('1. e4');
      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { analysis: { whiteAccuracy: 99, blackAccuracy: 99, moves: [] } }
      });
      expect(res).toBeDefined();
    });
  });

  describe('analyzePgn', () => {
    it('should analyze short PGN using cached redis values', async () => {
      // Very short PGN
      const pgn = '1. e4';
      
      mockRedisClient.get.mockResolvedValue(JSON.stringify({
        eval: 50,
        mate: null,
        move: 'e5',
        centipawns: 50
      }));

      const res = await service.analyzePgn(pgn);
      
      // 1 move -> 1 positions (start + e4), but we compare i-1 and i, so 1 classified move
      expect(res.moves.length).toBe(1);
      expect(res.moves[0].classification).toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled(); // Cached!
    });

    it('should fetch from API if not cached', async () => {
      const pgn = '1. e4';
      
      mockRedisClient.get.mockResolvedValue(null);
      (global.fetch as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          eval: 30,
          mate: null,
          move: 'e5',
          centipawns: '30' // testing string parsing
        })
      });

      const res = await service.analyzePgn(pgn);
      
      expect(global.fetch).toHaveBeenCalled();
      expect(mockRedisClient.set).toHaveBeenCalled();
      expect(res.moves.length).toBe(1);
      expect(res.moves[0].centipawns).toBe(30);
    });

    it('should handle fetch errors gracefully', async () => {
      const pgn = '1. e4';
      
      mockRedisClient.get.mockResolvedValue(null);
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const res = await service.analyzePgn(pgn);
      
      expect(Logger.prototype.error).toHaveBeenCalled();
      expect(res.moves[0].eval).toBe(0);
      expect(res.moves[0].centipawns).toBe(0);
    });

    it('should calculate CAPS accurately', async () => {
       const pgn = '1. e4 e5';
       mockRedisClient.get.mockResolvedValue(JSON.stringify({
        eval: 0, centipawns: 0
       }));

       const res = await service.analyzePgn(pgn);
       expect(res.whiteAccuracy).toBeDefined();
       expect(res.blackAccuracy).toBeDefined();
    });
  });
});
