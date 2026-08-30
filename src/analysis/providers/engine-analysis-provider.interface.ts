/** Public token AnalysisService depends on — resolves to the caching decorator. */
export const ENGINE_ANALYSIS_PROVIDER = Symbol('ENGINE_ANALYSIS_PROVIDER');
/** The undecorated engine the caching decorator wraps. */
export const RAW_ENGINE_ANALYSIS_PROVIDER = Symbol('RAW_ENGINE_ANALYSIS_PROVIDER');

export interface EngineEvaluation {
  eval: number;
  mate: number | null;
  bestMove: string | null;
  centipawns: number;
  depth?: number;
}

/**
 * A source of chess engine evaluations for a position. AnalysisService
 * depends on this interface, not on any specific engine API — swapping
 * providers (a different HTTP API, a self-hosted Stockfish) means adding a
 * new implementation, not editing the service. Implementations are
 * expected to throw on failure (network error, timeout, bad response);
 * callers decide how to handle that.
 */
export interface IEngineAnalysisProvider {
  evaluate(fen: string): Promise<EngineEvaluation>;
}
