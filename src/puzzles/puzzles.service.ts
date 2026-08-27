import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuestsService } from '../quests/quests.service';
import { RedisService } from '../redis/redis.service';
import type Redis from 'ioredis';

@Injectable()
export class PuzzlesService {
  private readonly redisClient: Redis;

  constructor(
    private prisma: PrismaService,
    private questsService: QuestsService,
    private redisService: RedisService,
  ) {
    this.redisClient = this.redisService.getClient();
  }

  async getRatedPuzzle(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const userRating = user.ratingPuzzle;


    let puzzle = await this.prisma.puzzle.findFirst({
      where: {
        rating: {
          gte: userRating - 200,
          lte: userRating + 200,
        },
        puzzleAttempts: {
          none: {
            userId: userId,
          },
        },
      },
      orderBy: {
        rating: 'asc',
      },
    });

    if (!puzzle) {
      puzzle = await this.prisma.puzzle.findFirst({
        where: {
          puzzleAttempts: {
            none: {
              userId: userId,
            },
          },
        },
      });
      if (!puzzle) {
        return null; // Or throw NotFoundException
      }
    }

    // Record timestamp for validation
    await this.redisClient.set(`puzzle_start:${userId}:${puzzle.id}`, Date.now().toString(), 'EX', 3600);
    return puzzle;
  }

  async getCustomPuzzles(theme: string, limit = 10) {
    return this.prisma.puzzle.findMany({
      where: {
        themes: {
          has: theme,
        },
      },
      take: limit,
    });
  }

  async getDailyPuzzle() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let daily = await this.prisma.dailyPuzzle.findUnique({
      where: { date: today },
      include: { puzzle: true },
    });

    if (!daily) {

      const randomPuzzle = await this.prisma.puzzle.findFirst();
      if (!randomPuzzle) throw new NotFoundException('No puzzles in DB');

      daily = await this.prisma.dailyPuzzle.create({
        data: {
          date: today,
          puzzleId: randomPuzzle.id,
        },
        include: { puzzle: true },
      });
    }

    return daily;
  }

  async getBatchForRush(limit = 20) {

    const batch = await this.prisma.puzzle.findMany({
      orderBy: { rating: 'asc' },
      take: limit,
    });
    // This endpoint is used for rush, so it doesn't map directly to a single start time per puzzle here.
    // The client would need to report when they start each puzzle, or the server validates the whole batch time.
    // For now, we'll return the batch.
    return batch;
  }

  async submitAttempt(
    userId: string,
    puzzleId: string,
    movesMade: string[],
    timeSpentMs: number,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const puzzle = await this.prisma.puzzle.findUnique({
      where: { id: puzzleId },
    });

    if (!user || !puzzle)
      throw new NotFoundException('User or Puzzle not found');

    const startTimestampStr = await this.redisClient.get(`puzzle_start:${userId}:${puzzle.id}`);
    
    // Server-side timing validation
    if (!startTimestampStr) {
      throw new BadRequestException('Puzzle session not found or expired. Please start the puzzle through the proper endpoint.');
    }

    const startTimestamp = parseInt(startTimestampStr, 10);
    const actualTimeSpentMs = Date.now() - startTimestamp;

    // Minimum sensible time (e.g., 500ms per move in the puzzle)
    const minPossibleTime = (puzzle.moves.length / 2) * 500;
    
    if (actualTimeSpentMs < minPossibleTime) {
      throw new BadRequestException('Puzzle solved impossibly fast. Attempt rejected.');
    }

    // Cleanup session
    await this.redisClient.del(`puzzle_start:${userId}:${puzzle.id}`);

    const success = JSON.stringify(movesMade) === JSON.stringify(puzzle.moves);

    const expectedScore =
      1 / (1 + Math.pow(10, (puzzle.rating - user.ratingPuzzle) / 400));
    const actualScore = success ? 1 : 0;
    const K = 32;

    const ratingChange = Math.round(K * (actualScore - expectedScore));

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { ratingPuzzle: Math.max(100, user.ratingPuzzle + ratingChange) },
    });


    const pRatingChange = Math.round(
      16 * (1 - actualScore - (1 - expectedScore)),
    );

    await this.prisma.puzzle.update({
      where: { id: puzzleId },
      data: {
        rating: Math.max(100, puzzle.rating + pRatingChange),
        attempts: { increment: 1 },
        successes: { increment: success ? 1 : 0 },
      },
    });

    await this.prisma.puzzleAttempt.create({
      data: {
        userId,
        puzzleId,
        success,
        timeSpentMs,
        ratingDiff: ratingChange,
      },
    });

    if (success) {
      await this.questsService
        .incrementQuestProgress(userId, 'SOLVE_PUZZLES')
        .catch(() => {});
    }

    return {
      newRating: updatedUser.ratingPuzzle,
      ratingChange,
      success,
    };
  }

  async getDailyPuzzleComments(dailyPuzzleId: string) {
    return this.prisma.dailyPuzzleComment.findMany({
      where: { dailyPuzzleId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            ratingPuzzle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addDailyPuzzleComment(
    userId: string,
    dailyPuzzleId: string,
    content: string,
  ) {
    return this.prisma.dailyPuzzleComment.create({
      data: {
        userId,
        dailyPuzzleId,
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            ratingPuzzle: true,
          },
        },
      },
    });
  }
}
