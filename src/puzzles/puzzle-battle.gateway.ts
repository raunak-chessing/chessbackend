import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsAuthService } from '../common/ws-auth.service';
import { CacheService } from '../redis/cache.service';
import { PuzzleBattleService } from './puzzle-battle.service';
import type { AuthenticatedSocket } from '../types';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
  namespace: '/puzzle-battle',
})
export class PuzzleBattleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsAuthService: WsAuthService,
    private readonly cacheService: CacheService,
    private readonly puzzleBattleService: PuzzleBattleService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const user = await this.wsAuthService.resolveUser(client);
    if (user) {
      client.data.user = user;
      return;
    }

    // Guest fallback: puzzle battles are open to unauthenticated visitors.
    client.data.user = {
      id: client.id,
      name: `Guest-${client.id.slice(0, 5)}`,
      email: 'guest@chess.local',
      ratingPuzzle: 1200,
    };
  }

  handleDisconnect(client: Socket) {
    const finishedRooms = this.puzzleBattleService.handleDisconnect(client.id);
    for (const { roomId } of finishedRooms) {
      this.server.to(roomId).emit('opponentDisconnected');
    }
  }

  @SubscribeMessage('joinQueue')
  async handleJoinQueue(@ConnectedSocket() client: AuthenticatedSocket) {
    const user = client.data.user as Record<string, unknown> | undefined;
    if (user?.isFlaggedForCheating) {
      client.emit('queueError', { message: 'Puzzle battles are disabled for this account' });
      return;
    }

    const userId = (client.data.user?.id as string) || client.id;
    const name = (client.data.user?.name as string) || `Guest-${client.id.slice(0, 5)}`;
    const rating = typeof user?.ratingPuzzle === 'number' ? user.ratingPuzzle : 1200;

    const result = await this.puzzleBattleService.joinQueue({
      id: userId,
      socketId: client.id,
      score: 0,
      rating,
      name,
    });
    if (!result.matched) return;

    const { room } = result;
    const [p1SocketId, p2SocketId] = Object.keys(room.players);
    const sockets = await this.server.fetchSockets();
    const s1 = sockets.find((s) => s.id === p1SocketId);
    const s2 = sockets.find((s) => s.id === p2SocketId);

    if (s1 && s2) {
      s1.join(room.id);
      s2.join(room.id);

      this.server.to(room.id).emit('matchFound', {
        roomId: room.id,
        puzzles: room.puzzles,
        players: Object.fromEntries(
          Object.entries(room.players).map(([socketId, p]) => [
            socketId,
            { id: p.id, name: p.name, rating: p.rating, socketId: p.socketId },
          ]),
        ),
      });
    }
  }

  @SubscribeMessage('leaveQueue')
  handleLeaveQueue(@ConnectedSocket() client: Socket) {
    this.puzzleBattleService.leaveQueue(client.id);
  }

  @SubscribeMessage('makeMove')
  async handleMakeMove(
    @MessageBody()
    data: { roomId: string; source: string; target: string; fen: string },
    @ConnectedSocket() client: Socket,
  ) {
    const withinLimit = await this.cacheService.checkRateLimit(`ratelimit:puzzle_move:${client.id}`, 20, 5);
    if (!withinLimit) return;

    if (!this.puzzleBattleService.isRoomActive(data.roomId, client.id)) return;

    client.to(data.roomId).emit('opponentMove', {
      source: data.source,
      target: data.target,
      fen: data.fen,
    });
  }

  @SubscribeMessage('puzzleSolved')
  handlePuzzleSolved(
    @MessageBody() data: { roomId: string; timeMs: number; roundIndex?: number },
    @ConnectedSocket() client: Socket,
  ) {
    const result = this.puzzleBattleService.recordPuzzleSolved(data.roomId, client.id, data.roundIndex);
    if (!result) return;

    this.server.to(data.roomId).emit('roundWon', {
      winnerSocketId: result.winnerSocketId,
      timeMs: data.timeMs,
      playerScore: result.playerScore,
    });

    if (result.battleEnded) {
      this.server.to(data.roomId).emit('battleEnded', {
        winnerId: result.battleEnded.winnerId,
        reason: 'score_reached',
      });
    }
  }

  @SubscribeMessage('sendEmote')
  async handleSendEmote(
    @MessageBody() data: { roomId: string; emoji: string },
    @ConnectedSocket() client: Socket,
  ) {
    const withinLimit = await this.cacheService.checkRateLimit(`ratelimit:puzzle_emote:${client.id}`, 10, 10);
    if (!withinLimit) return;

    if (!this.puzzleBattleService.isRoomActive(data.roomId, client.id)) return;

    client.to(data.roomId).emit('opponentEmote', {
      emoji: data.emoji,
    });
  }

  @SubscribeMessage('rematch')
  handleRematch(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Basic rematch support: if one wants a rematch, they leave and re-join queue for now.
    // Full rematch logic requires tracking both acceptances.
  }
}
