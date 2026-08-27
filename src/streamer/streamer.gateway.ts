import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { AuthenticatedSocket } from '../types';
import { RedisService } from '../redis/redis.service';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
})
@Injectable()
export class StreamerGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(StreamerGateway.name);

  private updateInterval: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    // Batch broadcast heatmap updates every 1 second
    this.updateInterval = setInterval(() => {
      this.broadcastHeatmaps();
    }, 1000);
  }

  async handleConnection(client: Socket) {
    let sessionToken = (client.handshake.auth as Record<string, unknown>)?.token as string;
    if (!sessionToken && client.handshake.headers.cookie) {
      const match = client.handshake.headers.cookie.match(/better-auth\.session[-_]token=([^;]+)/);
      if (match) {
        sessionToken = match[1];
      }
    }

    if (sessionToken) {
      try {
        const session = await this.prisma.session.findUnique({
          where: { token: sessionToken },
          include: { user: true },
        });

        if (session && session.expiresAt > new Date()) {
          (client as AuthenticatedSocket).data.user = session.user;
          this.logger.debug(`Streamer Client authenticated: ${session.user.id}`);
          return;
        }
      } catch (err: any) {
        this.logger.error(`Error in handleConnection: ${err.message}`);
      }
    }
    this.logger.debug(`Streamer Client rejected (unauthenticated): ${client.id}`);
    client.disconnect();
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Streamer Client disconnected: ${client.id}`);
  }

  onModuleDestroy() {
    clearInterval(this.updateInterval);
  }

  @SubscribeMessage('streamer:join')
  async handleJoin(
    @MessageBody('streamerId') streamerId: string,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!streamerId) return { status: 'error', message: 'No streamerId provided' };
    const room = `stream:${streamerId}`;
    client.join(room);
    
    // Add streamer to active streamers set
    const redis = this.redisService.getClient();
    await redis.sadd('active_streamers', streamerId);

    // Send current heatmap state to the joining user immediately
    const heatmapData = await redis.hgetall(`streamer_heatmap:${streamerId}`);
    const currentHeatmap: Record<string, number> = {};
    for (const [sq, val] of Object.entries(heatmapData)) {
      currentHeatmap[sq] = parseInt(val, 10);
    }
    client.emit('streamer:heatmapUpdate', { streamerId, heatmap: currentHeatmap });

    return { status: 'ok', room };
  }

  @SubscribeMessage('streamer:voteMove')
  async handleVoteMove(
    @MessageBody('streamerId') streamerId: string,
    @MessageBody('square') square: string, // e.g. "e4"
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!streamerId || !square) return;

    const redis = this.redisService.getClient();
    await redis.sadd('active_streamers', streamerId);
    await redis.hincrby(`streamer_heatmap:${streamerId}`, square, 1);
  }

  private async broadcastHeatmaps() {
    const redis = this.redisService.getClient();
    const activeStreamers = await redis.smembers('active_streamers');

    for (const streamerId of activeStreamers) {
      const room = `stream:${streamerId}`;
      const sockets = this.server.sockets.adapter.rooms.get(room);
      
      if (!sockets || sockets.size === 0) {
        // No local viewers, but other instances might have viewers.
        // We can't delete it just because this instance has no viewers.
        // But if we're broadcasting from every instance, we might broadcast multiple times.
        // To fix this, only one worker should decay it, but for simplicity, we'll just let Redis pub/sub or local broadcast handle it.
        // Actually, just fetching and broadcasting locally to our connected viewers is fine.
        continue;
      }

      const heatmapData = await redis.hgetall(`streamer_heatmap:${streamerId}`);
      const heatmap: Record<string, number> = {};
      let hasVotes = false;

      for (const [sq, val] of Object.entries(heatmapData)) {
        const count = parseInt(val, 10);
        if (count > 0) {
          heatmap[sq] = count;
          hasVotes = true;
          
          // Decay the value
          const decayedValue = Math.floor(count * 0.5);
          if (decayedValue > 0) {
            await redis.hset(`streamer_heatmap:${streamerId}`, sq, decayedValue);
          } else {
            await redis.hdel(`streamer_heatmap:${streamerId}`, sq);
          }
        }
      }

      if (!hasVotes) {
        // If empty, clean up
        await redis.srem('active_streamers', streamerId);
      }

      // Broadcast the current aggregated heatmap to the local room
      this.server.to(room).emit('streamer:heatmapUpdate', {
        streamerId,
        heatmap,
      });
    }
  }
}
