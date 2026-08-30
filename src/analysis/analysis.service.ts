import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisMove, AnalysisResult } from '../types';
import { ChessReplayService } from './chess-replay.service';
import { MoveClassifierService } from './move-classifier.service';
import { ENGINE_ANALYSIS_PROVIDER } from './providers/engine-analysis-provider.interface';
import type { IEngineAnalysisProvider } from './providers/engine-analysis-provider.interface';

const EVALUATION_CHUNK_SIZE = 5; // Batch requests to not overwhelm the API.

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chessReplayService: ChessReplayService,
    private readonly moveClassifierService: MoveClassifierService,
    @Inject(ENGINE_ANALYSIS_PROVIDER) private readonly engineProvider: IEngineAnalysisProvider,
  ) {}

  async analyzeGame(gameId: string) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new Error('Game not found');
    if (game.analysis) return game.analysis;

    const finalAnalysis = await this.analyzePgn(game.pgn);

    await this.prisma.game.update({
      where: { id: gameId },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { analysis: finalAnalysis as any }, // Prisma JSON type workaround
    });

    return finalAnalysis;
  }

  async analyzePgn(pgn: string): Promise<AnalysisResult> {
    const positions = this.chessReplayService.replay(pgn);
    this.logger.log(`Analyzing PGN with ${positions.length} positions...`);

    const evaluatedPositions = await this.evaluateAll(positions);
    const classifiedMoves = this.classifyAll(evaluatedPositions);

    return {
      ...this.computeCaps(classifiedMoves),
      moves: classifiedMoves,
    };
  }

  private async evaluateAll(positions: AnalysisMove[]): Promise<AnalysisMove[]> {
    const evaluated: AnalysisMove[] = [];

    for (let i = 0; i < positions.length; i += EVALUATION_CHUNK_SIZE) {
      const chunk = positions.slice(i, i + EVALUATION_CHUNK_SIZE);

      const results = await Promise.all(
        chunk.map(async (pos) => {
          try {
            const evaluation = await this.engineProvider.evaluate(pos.fen);
            return { ...pos, ...evaluation };
          } catch (e: unknown) {
            const errMessage = e instanceof Error ? e.message : 'Unknown error';
            this.logger.error(`Error fetching analysis for FEN ${pos.fen}: ${errMessage}`);
            return { ...pos, eval: 0, mate: null, centipawns: 0, bestMove: null };
          }
        }),
      );

      evaluated.push(...results);
    }

    return evaluated;
  }

  private classifyAll(positions: AnalysisMove[]): AnalysisMove[] {
    // Compare position N with position N+1, from the perspective of the
    // player who just moved. Position 0 is the starting position — there's
    // no move to classify there.
    const classified: AnalysisMove[] = [];

    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];

      const { classification, explanation } = this.moveClassifierService.classify(prev, curr, i);
      const moveAccuracy = this.moveClassifierService.accuracyFor(classification);

      classified.push({
        move: curr.move,
        fen: curr.fen,
        color: curr.color,
        eval: curr.eval,
        mate: curr.mate,
        centipawns: curr.centipawns,
        bestMove: curr.bestMove,
        classification,
        explanation,
        moveAccuracy,
      });
    }

    return classified;
  }

  private computeCaps(classifiedMoves: AnalysisMove[]): Pick<AnalysisResult, 'whiteAccuracy' | 'blackAccuracy'> {
    let whiteAccSum = 0;
    let blackAccSum = 0;
    let whiteMoves = 0;
    let blackMoves = 0;

    for (const m of classifiedMoves) {
      if (m.color === 'w') {
        whiteAccSum += m.moveAccuracy ?? 100;
        whiteMoves++;
      } else {
        blackAccSum += m.moveAccuracy ?? 100;
        blackMoves++;
      }
    }

    return {
      whiteAccuracy: whiteMoves > 0 ? +(whiteAccSum / whiteMoves).toFixed(1) : 100,
      blackAccuracy: blackMoves > 0 ? +(blackAccSum / blackMoves).toFixed(1) : 100,
    };
  }
}
