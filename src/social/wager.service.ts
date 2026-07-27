import { Injectable, BadRequestException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';

interface Wager {
  userId: string;
  amount: number;
  predictedWinnerId: string; // the player they bet on
}

interface WagerPool {
  wagers: Wager[];
  totalPool: number;
  odds: { [playerId: string]: number };
}

@Injectable()
export class WagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerService.name);
  private redisClient: Redis;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private redisService: RedisService,
  ) {
    this.redisClient = this.redisService.getClient();
  }

  async onModuleInit() {
    this.logger.log('WagerService (Enterprise) Initialized');
  }

  onModuleDestroy() {
    // Redis client is shared, do not disconnect here
  }

  async createWagerPool(gameId: string, player1Id: string, player2Id: string, p1Elo: number, p2Elo: number) {
    const eloDiff = p1Elo - p2Elo;
    const p1Prob = 1 / (1 + Math.pow(10, -eloDiff / 400));
    const p2Prob = 1 - p1Prob;

    const odds = {
      [player1Id]: 1 / p1Prob,
      [player2Id]: 1 / p2Prob,
    };

    // Store odds in a hash
    await this.redisClient.hset(`wager_odds:${gameId}`, odds);
    await this.redisClient.expire(`wager_odds:${gameId}`, 86400);

    this.logger.log(`Created Redis Wager Pool for game ${gameId}. Odds: ${player1Id}(${odds[player1Id].toFixed(2)}x) vs ${player2Id}(${odds[player2Id].toFixed(2)}x)`);
    return odds;
  }

  async placeWager(userId: string, gameId: string, predictedWinnerId: string, amount: number) {
    if (amount <= 0) throw new BadRequestException('Amount must be greater than 0');

    const oddsExists = await this.redisClient.exists(`wager_odds:${gameId}`);
    if (!oddsExists) throw new BadRequestException('No active betting pool for this game');

    // Execute atomic transaction for inventory deduction
    await this.prisma.$transaction(async (tx) => {
      const inventory = await tx.playerInventory.findUnique({ where: { userId } });
      if (!inventory || inventory.gold < amount) {
        throw new BadRequestException('Insufficient gold for wager');
      }

      await tx.playerInventory.update({
        where: { userId },
        data: { gold: { decrement: amount } }
      });
    }, { isolationLevel: 'ReadCommitted' });

    // Store wager amounts in a Redis Hash. Key: `wager_pool:{gameId}`, Field: `{userId}:{predictedWinnerId}`, Value: amount
    // If the user bets again, it safely increments.
    await this.redisClient.hincrby(`wager_pool:${gameId}`, `${userId}:${predictedWinnerId}`, amount);
    await this.redisClient.expire(`wager_pool:${gameId}`, 86400);

    const oddsStr = await this.redisClient.hget(`wager_odds:${gameId}`, predictedWinnerId);
    return { success: true, odds: oddsStr ? parseFloat(oddsStr) : 1 };
  }

  async settleWagers(gameId: string, actualWinnerId: string | null) {
    const pool = await this.redisClient.hgetall(`wager_pool:${gameId}`);
    if (!pool || Object.keys(pool).length === 0) return;

    const odds = await this.redisClient.hgetall(`wager_odds:${gameId}`);

    if (!actualWinnerId) {
      this.logger.log(`Game ${gameId} ended in draw. Refunding wagers.`);
      const refundOps = Object.entries(pool).map(([field, amountStr]) => {
        const [userId] = field.split(':');
        return this.prisma.playerInventory.update({
          where: { userId },
          data: { gold: { increment: parseInt(amountStr, 10) } }
        });
      });
      await this.prisma.$transaction(refundOps);
    } else {
      const payoutMultiplier = odds[actualWinnerId] ? parseFloat(odds[actualWinnerId]) : 1;
      
      const winnerOps: any[] = [];
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
  }
}
