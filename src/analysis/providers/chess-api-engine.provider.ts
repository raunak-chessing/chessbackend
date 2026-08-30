import { Injectable } from '@nestjs/common';
import { EngineEvaluation, IEngineAnalysisProvider } from './engine-analysis-provider.interface';

const CHESS_API_URL = 'https://chess-api.com/v1';
const REQUEST_TIMEOUT_MS = 5000;
const ENGINE_DEPTH = 15;

interface ChessApiResponse {
  eval: number;
  mate: number | null;
  move: string;
  centipawns: string | number;
}

@Injectable()
export class ChessApiEngineProvider implements IEngineAnalysisProvider {
  async evaluate(fen: string): Promise<EngineEvaluation> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(CHESS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, depth: ENGINE_DEPTH }),
        signal: controller.signal,
      });
      const data = (await res.json()) as ChessApiResponse;

      return {
        eval: data.eval || 0,
        mate: data.mate || null,
        bestMove: data.move || null,
        // Centipawns can be a string or number in the API.
        centipawns:
          typeof data.centipawns === 'string'
            ? parseInt(data.centipawns)
            : data.centipawns || data.eval * 100 || 0,
        depth: ENGINE_DEPTH,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
