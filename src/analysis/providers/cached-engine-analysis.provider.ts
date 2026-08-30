import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '../../redis/cache.service';
import { RAW_ENGINE_ANALYSIS_PROVIDER } from './engine-analysis-provider.interface';
import type { EngineEvaluation, IEngineAnalysisProvider } from './engine-analysis-provider.interface';

const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const cacheKeyFor = (fen: string) => `fen_eval:${fen}`;

/**
 * Decorator (Decorator pattern): adds Redis caching around any
 * IEngineAnalysisProvider without that provider needing to know caching
 * exists. Only successful evaluations are cached — a failure propagates
 * uncached, so a transient outage doesn't get "frozen in" for 30 days.
 */
@Injectable()
export class CachedEngineAnalysisProvider implements IEngineAnalysisProvider {
  constructor(
    @Inject(RAW_ENGINE_ANALYSIS_PROVIDER) private readonly inner: IEngineAnalysisProvider,
    private readonly cacheService: CacheService,
  ) {}

  async evaluate(fen: string): Promise<EngineEvaluation> {
    const cacheKey = cacheKeyFor(fen);
    const cached = await this.cacheService.getJson<EngineEvaluation>(cacheKey);
    if (cached) return cached;

    const evaluation = await this.inner.evaluate(fen);
    await this.cacheService.setJson(cacheKey, evaluation, CACHE_TTL_SECONDS);
    return evaluation;
  }
}
