import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Chess } from 'chess.js';

@Injectable()
export class VoteChessService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;
  private readonly logger = new Logger(VoteChessService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      db: 4, // separate db for vote chess
    });
  }

  async onModuleInit() {
    this.logger.log('Vote Chess Module Initialized');
  }

  onModuleDestroy() {
    this.redisClient.disconnect();
  }

  async getActiveBossFight() {
    const data = await this.redisClient.get('boss_fight_state');
    if (!data) return null;
    return JSON.parse(data);
  }

  // Called via REST/Gateway when a user votes
  async submitVote(userId: string, sanMove: string) {
    const state = await this.getActiveBossFight();
    if (!state || !state.isActive) {
      throw new Error("No active boss fight");
    }
    
    // Make sure move is legal
    const chess = new Chess(state.fen);
    try {
      chess.move(sanMove);
    } catch(e) {
      throw new Error("Illegal move");
    }

    // Add to Redis Hash (userId -> sanMove) so each user only gets 1 vote
    await this.redisClient.hset('boss_fight_votes', userId, sanMove);
    return { success: true, move: sanMove };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async executeMajorityMove() {
    const state = await this.getActiveBossFight();
    if (!state || !state.isActive) return;

    this.logger.log('Executing majority vote against The Titan...');
    
    // Tally votes
    const votes = await this.redisClient.hgetall('boss_fight_votes');
    const tally: Record<string, number> = {};
    for (const move of Object.values(votes)) {
      tally[move] = (tally[move] || 0) + 1;
    }

    let topMove: string | null = null;
    let maxVotes = 0;
    for (const [move, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count;
        topMove = move;
      }
    }

    if (!topMove) {
      this.logger.log('No votes cast against The Titan. The server foregoes its turn.');
      // Handle timeout / fallback (e.g., random legal move)
      return;
    }

    const chess = new Chess(state.fen);
    chess.move(topMove);

    // Now it's the Titan's turn (Stockfish)
    // We would fetch from chess-api.com
    try {
      const res = await fetch('https://chess-api.com/v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: chess.fen(), depth: 15 }),
      });
      const data = await res.json();
      if (data.move) {
        chess.move(data.move);
      }
    } catch(e) {
      this.logger.error('Failed to fetch Titan move from Stockfish API');
    }

    // Save state back
    state.fen = chess.fen();
    state.turnCount += 1;

    // Check game over
    if (chess.isGameOver()) {
      state.isActive = false;
      this.logger.log(`The Boss Fight is over! Winner: ${chess.turn() === 'w' ? 'Titan (Black)' : 'Server (White)'}`);
      // Apply global buffs if Server won...
    }

    await this.redisClient.set('boss_fight_state', JSON.stringify(state));
    await this.redisClient.del('boss_fight_votes'); // reset votes for next turn
  }
}
