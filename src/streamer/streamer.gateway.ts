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
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { AuthenticatedSocket } from '../types';
import { WsAuthService } from '../common/ws-auth.service';
import { CacheService } from '../redis/cache.service';

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
    private readonly wsAuthService: WsAuthService,
    private readonly cacheService: CacheService,
  ) {
    // Batch broadcast heatmap updates every 1 second
    this.updateInterval = setInterval(() => {
      this.broadcastHeatmaps();
    }, 1000);
  }

  async handleConnection(client: Socket) {
    const user = await this.wsAuthService.resolveUser(client);
    if (user) {
      (client as AuthenticatedSocket).data.user = user;
      this.logger.debug(`Streamer Client authenticated: ${user.id}`);
      return;
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
    await this.cacheService.addToSet('active_streamers', streamerId);

    // Send current heatmap state to the joining user immediately
    const heatmapData = await this.cacheService.hashGetAll(`streamer_heatmap:${streamerId}`);
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

    await this.cacheService.addToSet('active_streamers', streamerId);
    await this.cacheService.hashIncrementBy(`streamer_heatmap:${streamerId}`, square, 1);
  }

  private async broadcastHeatmaps() {
    const activeStreamers = await this.cacheService.getSetMembers('active_streamers');

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

      const heatmapData = await this.cacheService.hashGetAll(`streamer_heatmap:${streamerId}`);
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
            await this.cacheService.hashSet(`streamer_heatmap:${streamerId}`, sq, String(decayedValue));
          } else {
            await this.cacheService.hashDelete(`streamer_heatmap:${streamerId}`, sq);
          }
        }
      }

      if (!hasVotes) {
        // If empty, clean up
        await this.cacheService.removeFromSet('active_streamers', streamerId);
      }

      // Broadcast the current aggregated heatmap to the local room
      this.server.to(room).emit('streamer:heatmapUpdate', {
        streamerId,
        heatmap,
      });
    }
  }
}
