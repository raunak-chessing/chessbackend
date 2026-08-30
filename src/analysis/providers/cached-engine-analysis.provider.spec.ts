import { Test, TestingModule } from '@nestjs/testing';
import { CachedEngineAnalysisProvider } from './cached-engine-analysis.provider';
import { RAW_ENGINE_ANALYSIS_PROVIDER, IEngineAnalysisProvider } from './engine-analysis-provider.interface';
import { CacheService } from '../../redis/cache.service';

describe('CachedEngineAnalysisProvider', () => {
  let provider: CachedEngineAnalysisProvider;
  let inner: jest.Mocked<IEngineAnalysisProvider>;
  let cacheService: jest.Mocked<Pick<CacheService, 'getJson' | 'setJson'>>;

  beforeEach(async () => {
    inner = { evaluate: jest.fn() };
    cacheService = { getJson: jest.fn(), setJson: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CachedEngineAnalysisProvider,
        { provide: RAW_ENGINE_ANALYSIS_PROVIDER, useValue: inner },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    provider = module.get(CachedEngineAnalysisProvider);
  });

  it('returns a cached evaluation without calling the inner provider', async () => {
    const cached = { eval: 1, mate: null, bestMove: 'e4', centipawns: 100, depth: 15 };
    cacheService.getJson.mockResolvedValueOnce(cached);

    const result = await provider.evaluate('fen-1');

    expect(result).toEqual(cached);
    expect(inner.evaluate).not.toHaveBeenCalled();
  });

  it('fetches from the inner provider and caches the result on a miss', async () => {
    cacheService.getJson.mockResolvedValueOnce(null);
    const fresh = { eval: 0.5, mate: null, bestMove: 'e5', centipawns: 50, depth: 15 };
    inner.evaluate.mockResolvedValueOnce(fresh);

    const result = await provider.evaluate('fen-1');

    expect(result).toEqual(fresh);
    expect(cacheService.setJson).toHaveBeenCalledWith('fen_eval:fen-1', fresh, 30 * 24 * 60 * 60);
  });

  it('does not cache a failure — a transient outage should not get frozen in for 30 days', async () => {
    cacheService.getJson.mockResolvedValueOnce(null);
    inner.evaluate.mockRejectedValueOnce(new Error('engine down'));

    await expect(provider.evaluate('fen-1')).rejects.toThrow('engine down');
    expect(cacheService.setJson).not.toHaveBeenCalled();
  });
});
