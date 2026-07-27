import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisService } from '../analysis/analysis.service';

@Processor('anti-cheat-queue')
export class AntiCheatProcessor extends WorkerHost {
  private readonly logger = new Logger(AntiCheatProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: AnalysisService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing anti-cheat check for game ${job.data.gameId}`);

    const { gameId, whitePlayerId, blackPlayerId, pgn, moves } = job.data;
    if (!pgn || pgn.trim() === '') {
      return { status: 'skipped', reason: 'No PGN provided' };
    }

    try {
      // 1. Fetch real CAPS accuracy using AnalysisService
      const analysis = await this.analysisService.analyzePgn(pgn);
      const whiteAccuracy = analysis.whiteAccuracy;
      const blackAccuracy = analysis.blackAccuracy;

      const flagUser = async (userId: string, currentAccuracy: number) => {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) return null;

        // Ensure we have a baseline
        if (user.gamesAnalyzed >= 5) {
          const expectedAccuracy = user.averageCaps;
          const deviation = currentAccuracy - expectedAccuracy;

          // Flag if accuracy is > 95% AND it's a massive deviation from their historical average
          if (currentAccuracy >= 95 && deviation >= 25) {
            const reason = `Heuristic: Abnormal CAPS accuracy (${currentAccuracy}%). Historical average is ${expectedAccuracy.toFixed(1)}%.`;
            
            await this.prisma.user.update({
              where: { id: userId },
              data: { 
                isFlaggedForCheating: true,
                flaggedReason: reason
              },
            });
            this.logger.warn(`Suspicious activity detected in game ${gameId} for user ${userId}. Reason: ${reason}`);
            return userId;
          }
        }

        // Update rolling average
        const newTotalGames = user.gamesAnalyzed + 1;
        const newAverageCaps = ((user.averageCaps * user.gamesAnalyzed) + currentAccuracy) / newTotalGames;

        await this.prisma.user.update({
          where: { id: userId },
          data: {
            averageCaps: newAverageCaps,
            gamesAnalyzed: newTotalGames,
          },
        });

        return null;
      };

      let flaggedWhite: string | null = null;
      let flaggedBlack: string | null = null;

      if (whitePlayerId) {
        flaggedWhite = await flagUser(whitePlayerId, whiteAccuracy);
      }
      if (blackPlayerId) {
        flaggedBlack = await flagUser(blackPlayerId, blackAccuracy);
      }

      return { 
        status: 'completed', 
        flaggedWhite: !!flaggedWhite,
        flaggedBlack: !!flaggedBlack
      };

    } catch (err: any) {
      this.logger.error(`Failed to process anti-cheat for game ${gameId}: ${err.message}`);
      throw err;
    }
  }
}
