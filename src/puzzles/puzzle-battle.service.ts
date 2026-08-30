import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuestsService } from '../quests/quests.service';
import { FactionsService } from '../factions/factions.service';
import type { Puzzle } from '@prisma/client';

export interface BattlePlayer {
  id: string;
  socketId: string;
  score: number;
  rating: number;
  name: string;
}

export interface BattleRoom {
  id: string;
  players: Record<string, BattlePlayer>;
  puzzles: Puzzle[];
  status: 'IN_PROGRESS' | 'FINISHED';
  roundIndex: number;
}

export type JoinQueueResult = { matched: false } | { matched: true; room: BattleRoom };

export interface DisconnectedRoom {
  roomId: string;
}

export interface PuzzleSolvedResult {
  winnerSocketId: string;
  playerScore: number;
  battleEnded?: { winnerId: string; loserId?: string };
}

/**
 * Puzzle-battle matchmaking, room state, scoring, and reward distribution.
 *
 * Previously all of this lived directly inside PuzzleBattleGateway, mixed
 * with WebSocket transport concerns and connection auth — a single class
 * doing six-plus unrelated jobs with no test coverage. The gateway is now
 * a thin adapter: parse the socket event, call this service, emit the
 * result. All state and rules live here, where they can be unit tested
 * without a real Socket.IO connection.
 *
 * Note: queue/room state is in-memory, same as before this refactor — that
 * is a separate, real scalability concern (this won't work correctly
 * across multiple backend instances) but is out of scope for this pass,
 * which is about SOLID structure, not horizontal scaling.
 */
@Injectable()
export class PuzzleBattleService {
  private queue: BattlePlayer[] = [];
  private rooms: Record<string, BattleRoom> = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly questsService: QuestsService,
    private readonly factionsService: FactionsService,
  ) {}

  async joinQueue(player: BattlePlayer): Promise<JoinQueueResult> {
    // Prevent double joining.
    this.queue = this.queue.filter((p) => p.id !== player.id);
    this.queue.push(player);

    if (this.queue.length < 2) return { matched: false };

    const p1 = this.queue.shift()!;
    const p2 = this.queue.shift()!;
    const roomId = `battle_${p1.id}_${p2.id}`;

    // Fetch 7 random puzzles.
    const totalPuzzles = await this.prisma.puzzle.count();
    const skip = Math.max(0, Math.floor(Math.random() * (totalPuzzles - 7)));
    const puzzles = await this.prisma.puzzle.findMany({ take: 7, skip });

    const room: BattleRoom = {
      id: roomId,
      players: { [p1.socketId]: p1, [p2.socketId]: p2 },
      puzzles,
      status: 'IN_PROGRESS',
      roundIndex: 0,
    };
    this.rooms[roomId] = room;

    return { matched: true, room };
  }

  leaveQueue(socketId: string): void {
    this.queue = this.queue.filter((p) => p.socketId !== socketId);
  }

  /** Removes the socket from the queue and any room, reporting rooms that were force-finished mid-game. */
  handleDisconnect(socketId: string): DisconnectedRoom[] {
    this.queue = this.queue.filter((p) => p.socketId !== socketId);

    const affected: DisconnectedRoom[] = [];
    for (const [roomId, room] of Object.entries(this.rooms)) {
      if (room.players[socketId]) {
        if (room.status === 'IN_PROGRESS') {
          room.status = 'FINISHED';
          affected.push({ roomId });
        }
        delete this.rooms[roomId];
      }
    }
    return affected;
  }

  isRoomActive(roomId: string, socketId: string): boolean {
    const room = this.rooms[roomId];
    return !!(room && room.status === 'IN_PROGRESS' && room.players[socketId]);
  }

  recordPuzzleSolved(roomId: string, socketId: string, roundIndex?: number): PuzzleSolvedResult | null {
    const room = this.rooms[roomId];
    if (!room || room.status !== 'IN_PROGRESS') return null;
    if (roundIndex !== undefined && roundIndex !== room.roundIndex) {
      return null; // Stale solve due to a race condition.
    }

    const player = room.players[socketId];
    if (!player) return null;

    player.score += 1;
    room.roundIndex += 1;

    const result: PuzzleSolvedResult = { winnerSocketId: socketId, playerScore: player.score };

    if (player.score === 3) {
      room.status = 'FINISHED';
      const winnerId = player.id;
      const loserId = Object.values(room.players).find((p) => p.id !== winnerId)?.id;
      result.battleEnded = { winnerId, loserId };

      this.distributeRewards(winnerId, loserId);

      setTimeout(() => {
        delete this.rooms[roomId];
      }, 10000);
    }

    return result;
  }

  private distributeRewards(winnerId: string, loserId?: string): void {
    this.questsService.incrementQuestProgress(winnerId, 'WIN_PUZZLE_BATTLE').catch(() => {});
    this.questsService.incrementQuestProgress(winnerId, 'PLAY_BATTLES').catch(() => {});
    this.factionsService.incrementFactionScoreForUser(winnerId, 25).catch(() => {});

    if (loserId) {
      this.questsService.incrementQuestProgress(loserId, 'PLAY_BATTLES').catch(() => {});
    }
  }
}
