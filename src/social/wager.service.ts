import { Injectable, BadRequestException, ForbiddenException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, PlayerInventory } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { WagerLockService } from './wager-lock.service';
import * as crypto from 'crypto';

interface Wager {
  userId: string;
  amount: number;
  predictedWinnerId: string;
}

interface WagerPool {
  wagers: Wager[];
  totalPool: number;
  odds: { [playerId: string]: number };
}

@Injectable()
export class WagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerService.name);
  private redisClient: ReturnType<RedisService['getClient']>;
  private eventSubscriber: ReturnType<RedisService['getClient']> | null = null;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private redisService: RedisService,
    private wagerLockService: WagerLockService,
  ) {
    this.redisClient = this.redisService.getClient();
  }

  async onModuleInit() {
    this.logger.log('WagerService (Enterprise) Initialized');
    this.listenForGameEndEvents();
  }

  onModuleDestroy() {
    this.eventSubscriber?.disconnect();
  }

  private listenForGameEndEvents() {
    this.eventSubscriber = this.redisService.getClient().duplicate();
    this.eventSubscriber.subscribe('gameserver:events', (err) => {
      if (err) this.logger.error('Failed to subscribe to gameserver events', err);
    });

    this.eventSubscriber.on('message', async (channel, message) => {
      if (channel !== 'gameserver:events') return;
      try {
        const event = JSON.parse(message);
        if (event.type === 'game_ended' && event.gameId) {
          await this.settleWagersForGame(event.gameId);
        }
      } catch (e) {
        this.logger.error('Error processing game_ended event for wager settlement', e as Error);
      }
    });
  }

  private async settleWagersForGame(gameId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { winner: true, whitePlayerId: true, blackPlayerId: true },
    });
    if (!game) return;

    let actualWinnerId: string | null = null;
    if (game.winner === 'WHITE') actualWinnerId = game.whitePlayerId;
    else if (game.winner === 'BLACK') actualWinnerId = game.blackPlayerId ?? null;

    await this.settleWagers(gameId, actualWinnerId);
  }

  async createWagerPool(gameId: string, player1Id: string, player2Id: string, p1Elo: number, p2Elo: number) {
    const eloDiff = p1Elo - p2Elo;
    const p1Prob = 1 / (1 + Math.pow(10, -eloDiff / 400));
    const p2Prob = 1 - p1Prob;

    const odds = {
      [player1Id]: 1 / p1Prob,
      [player2Id]: 1 / p2Prob,
    };

    await this.redisClient.hset(`wager_odds:${gameId}`, odds);
    await this.redisClient.expire(`wager_odds:${gameId}`, 86400);

    this.logger.log(`Created Redis Wager Pool for game ${gameId}. Odds: ${player1Id}(${odds[player1Id].toFixed(2)}x) vs ${player2Id}(${odds[player2Id].toFixed(2)}x)`);
    return odds;
  }

  async placeWager(userId: string, gameId: string, predictedWinnerId: string, amount: number) {
    if (amount <= 0) throw new BadRequestException('Amount must be greater than 0');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isFlaggedForCheating: true },
    });
    if (user?.isFlaggedForCheating) {
      throw new ForbiddenException('Wagering is disabled for this account');
    }

    const oddsExists = await this.redisClient.exists(`wager_odds:${gameId}`);
    if (!oddsExists) throw new BadRequestException('No active betting pool for this game');

    const result = await this.wagerLockService.withLock(gameId, 5, async () => {
      const debit = await this.prisma.playerInventory.updateMany({
        where: { userId, gold: { gte: amount } },
        data: { gold: { decrement: amount } },
      });
      if (debit.count === 0) {
        throw new BadRequestException('Insufficient gold for wager');
      }

      try {
        await this.redisClient.hincrby(`wager_pool:${gameId}`, `${userId}:${predictedWinnerId}`, amount);
        await this.redisClient.expire(`wager_pool:${gameId}`, 86400);
      } catch (err) {
        await this.prisma.playerInventory.update({
          where: { userId },
          data: { gold: { increment: amount } },
        });
        throw err;
      }

      const oddsStr = await this.redisClient.hget(`wager_odds:${gameId}`, predictedWinnerId);
      return { success: true, odds: oddsStr ? parseFloat(oddsStr) : 1 };
    });

    if (result === null) {
      throw new BadRequestException('Wagers for this game are being processed, try again shortly');
    }
    return result;
  }

  async getOdds(gameId: string) {
    const odds = await this.redisClient.hgetall(`wager_odds:${gameId}`);
    return odds;
  }

  async settleWagers(gameId: string, actualWinnerId: string | null) {
    const settled = await this.wagerLockService.withLock(gameId, 10, async () => {
      const pool = await this.redisClient.hgetall(`wager_pool:${gameId}`);
      if (!pool || Object.keys(pool).length === 0) return;

      const odds = await this.redisClient.hgetall(`wager_odds:${gameId}`);

      const claim = await this.prisma.game.updateMany({
        where: { id: gameId, wagersSettledAt: null },
        data: { wagersSettledAt: new Date() },
      });
      if (claim.count === 0) {
        this.logger.warn(`Wagers for game ${gameId} were already settled; skipping duplicate settlement`);
        return;
      }

      if (!actualWinnerId) {
        this.logger.log(`Game ${gameId} ended in draw. Refunding wagers.`);
        const refundOps = Object.entries(pool).map(([field, amountStr]) => {
          const [userId] = field.split(':');
          return this.prisma.playerInventory.update({
            where: { userId },
            data: { gold: { increment: parseInt(amountStr, 10) } },
          });
        });
        await this.prisma.$transaction(refundOps);
      } else {
        const payoutMultiplier = odds[actualWinnerId] ? parseFloat(odds[actualWinnerId]) : 1;

        const winnerOps: Prisma.PrismaPromise<PlayerInventory>[] = [];
        for (const [field, amountStr] of Object.entries(pool)) {
          const [userId, predictedWinnerId] = field.split(':');
          if (predictedWinnerId === actualWinnerId) {
            const payout = Math.floor(parseInt(amountStr, 10) * payoutMultiplier);
            winnerOps.push(this.prisma.playerInventory.update({
              where: { userId },
              data: { gold: { increment: payout } }
            }));
          }
        }

        this.logger.log(`Game ${gameId} won by ${actualWinnerId}. Paying out ${winnerOps.length} winners at ${payoutMultiplier}x odds.`);
        if (winnerOps.length > 0) {
          await this.prisma.$transaction(winnerOps);
        }
      }

      await this.redisClient.del(`wager_pool:${gameId}`);
      await this.redisClient.del(`wager_odds:${gameId}`);
    });

    if (settled === null) {
      this.logger.warn(`Skipping settleWagers for game ${gameId}: a wager operation is already in progress`);
    }
  }
}
