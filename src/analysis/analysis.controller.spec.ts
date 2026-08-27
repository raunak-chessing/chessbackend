import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisController, AnalyzePgnDto } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from '../types';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => jest.fn(),
}));

const mockAnalysisService = {
  analyzePgn: jest.fn(),
  analyzeGame: jest.fn(),
};

describe('AnalysisController', () => {
  let controller: AnalysisController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalysisController],
      providers: [{ provide: AnalysisService, useValue: mockAnalysisService }],
    }).compile();

    controller = module.get<AnalysisController>(AnalysisController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('analyzePgn', () => {
    it('should throw an error if no pgn provided', async () => {
      await expect(controller.analyzePgn({ pgn: '' } as AnalyzePgnDto)).rejects.toThrow('PGN required');
    });

    it('should call analyzePgn on service', async () => {
      mockAnalysisService.analyzePgn.mockResolvedValueOnce({ moves: [] });
      const res = await controller.analyzePgn({ pgn: '1. e4 e5' } as AnalyzePgnDto);
      expect(mockAnalysisService.analyzePgn).toHaveBeenCalledWith('1. e4 e5');
      expect(res).toEqual({ moves: [] });
    });
  });

  describe('triggerAnalysis', () => {
    it('should throw UnauthorizedException if user not present', async () => {
      const req = { user: null } as unknown as AuthenticatedRequest;
      await expect(controller.triggerAnalysis(req, 'g1')).rejects.toThrow(UnauthorizedException);
    });

    it('should call analyzeGame on service', async () => {
      const req = { user: { id: 'u1' } } as unknown as AuthenticatedRequest;
      mockAnalysisService.analyzeGame.mockResolvedValueOnce({ id: 'g1' });
      const res = await controller.triggerAnalysis(req, 'g1');
      expect(mockAnalysisService.analyzeGame).toHaveBeenCalledWith('g1');
      expect(res).toEqual({ id: 'g1' });
    });
  });

  describe('getAnalysis', () => {
    it('should call analyzeGame on service', async () => {
      mockAnalysisService.analyzeGame.mockResolvedValueOnce({ id: 'g1' });
      const res = await controller.getAnalysis('g1');
      expect(mockAnalysisService.analyzeGame).toHaveBeenCalledWith('g1');
      expect(res).toEqual({ id: 'g1' });
    });
  });

  describe('getCoachAnalysis', () => {
    it('should return mock script', async () => {
      const res = await controller.getCoachAnalysis('g1');
      expect(res.script).toBeDefined();
      expect(res.script.length).toBe(4);
      expect(res.script[0].text).toContain('Welcome to your post-game review');
    });
  });
});
