import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from './analysis.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { ChessReplayService, ReplayedPosition } from './chess-replay.service';
import { MoveClassifierService, MoveClassification } from './move-classifier.service';
import { ENGINE_ANALYSIS_PROVIDER, IEngineAnalysisProvider } from './providers/engine-analysis-provider.interface';
import { Logger } from '@nestjs/common';

describe('AnalysisService', () => {
  let service: AnalysisService;
  let chessReplayService: jest.Mocked<Pick<ChessReplayService, 'replay'>>;
  let moveClassifierService: jest.Mocked<Pick<MoveClassifierService, 'classify' | 'accuracyFor'>>;
  let engineProvider: jest.Mocked<IEngineAnalysisProvider>;

  beforeEach(async () => {
    jest.clearAllMocks();

    chessReplayService = { replay: jest.fn() };
    moveClassifierService = { classify: jest.fn(), accuracyFor: jest.fn() };
    engineProvider = { evaluate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        getPrismaMockProvider(),
        { provide: ChessReplayService, useValue: chessReplayService },
        { provide: MoveClassifierService, useValue: moveClassifierService },
        { provide: ENGINE_ANALYSIS_PROVIDER, useValue: engineProvider },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
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
      const analyzeSpy = jest
        .spyOn(service, 'analyzePgn')
        .mockResolvedValueOnce({ whiteAccuracy: 99, blackAccuracy: 99, moves: [] });
      prismaMock.game.update.mockResolvedValueOnce({} as any);

      const res = await service.analyzeGame('g1');

      expect(analyzeSpy).toHaveBeenCalledWith('1. e4');
      expect(prismaMock.game.update).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { analysis: { whiteAccuracy: 99, blackAccuracy: 99, moves: [] } },
      });
      expect(res).toBeDefined();
    });
  });

  describe('analyzePgn', () => {
    const startPos: ReplayedPosition = { fen: 'start-fen', move: null };
    const movePos: ReplayedPosition = { fen: 'move-fen', move: 'e4', color: 'w' };

    it('evaluates every replayed position via the injected engine provider', async () => {
      chessReplayService.replay.mockReturnValueOnce([startPos, movePos]);
      engineProvider.evaluate.mockResolvedValue({ eval: 0.3, mate: null, bestMove: 'e5', centipawns: 30 });
      moveClassifierService.classify.mockReturnValue({ classification: MoveClassification.Good, explanation: 'ok' });
      moveClassifierService.accuracyFor.mockReturnValue(85);

      await service.analyzePgn('1. e4');

      expect(engineProvider.evaluate).toHaveBeenCalledWith('start-fen');
      expect(engineProvider.evaluate).toHaveBeenCalledWith('move-fen');
    });

    it('falls back to a zeroed evaluation and logs when the provider throws', async () => {
      chessReplayService.replay.mockReturnValueOnce([startPos, movePos]);
      engineProvider.evaluate.mockRejectedValue(new Error('provider down'));
      moveClassifierService.classify.mockReturnValue({ classification: MoveClassification.Good, explanation: 'ok' });
      moveClassifierService.accuracyFor.mockReturnValue(85);

      const res = await service.analyzePgn('1. e4');

      expect(Logger.prototype.error).toHaveBeenCalled();
      expect(res.moves[0].eval).toBe(0);
      expect(res.moves[0].centipawns).toBe(0);
      expect(res.moves[0].bestMove).toBeNull();
    });

    it('classifies each move and reports its accuracy', async () => {
      chessReplayService.replay.mockReturnValueOnce([startPos, movePos]);
      engineProvider.evaluate.mockResolvedValue({ eval: 0.3, mate: null, bestMove: 'e5', centipawns: 30 });
      moveClassifierService.classify.mockReturnValue({
        classification: MoveClassification.BestMove,
        explanation: 'The Seer nods approvingly. The optimal strike.',
      });
      moveClassifierService.accuracyFor.mockReturnValue(100);

      const res = await service.analyzePgn('1. e4');

      expect(moveClassifierService.classify).toHaveBeenCalledWith(
        expect.objectContaining({ fen: 'start-fen' }),
        expect.objectContaining({ fen: 'move-fen' }),
        1,
      );
      expect(res.moves).toHaveLength(1);
      expect(res.moves[0]).toMatchObject({
        move: 'e4',
        classification: MoveClassification.BestMove,
        moveAccuracy: 100,
      });
    });

    it('computes CAPS accuracy per color from each move\'s accuracy', async () => {
      const secondMovePos: ReplayedPosition = { fen: 'move2-fen', move: 'e5', color: 'b' };
      chessReplayService.replay.mockReturnValueOnce([startPos, movePos, secondMovePos]);
      engineProvider.evaluate.mockResolvedValue({ eval: 0, mate: null, bestMove: null, centipawns: 0 });
      moveClassifierService.classify
        .mockReturnValueOnce({ classification: MoveClassification.Excellent, explanation: '' })
        .mockReturnValueOnce({ classification: MoveClassification.Good, explanation: '' });
      moveClassifierService.accuracyFor.mockReturnValueOnce(95).mockReturnValueOnce(85);

      const res = await service.analyzePgn('1. e4 e5');

      expect(res.whiteAccuracy).toBe(95);
      expect(res.blackAccuracy).toBe(85);
    });

    it('defaults to 100 accuracy for a color with no moves', async () => {
      chessReplayService.replay.mockReturnValueOnce([startPos]);

      const res = await service.analyzePgn('');

      expect(res.whiteAccuracy).toBe(100);
      expect(res.blackAccuracy).toBe(100);
      expect(res.moves).toHaveLength(0);
    });
  });
});
