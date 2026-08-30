import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CacheService, CacheSubscription } from '../redis/cache.service';
import { WsAuthService } from '../common/ws-auth.service';
import { SocialService } from './social.service';
import * as crypto from 'crypto';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
@Injectable()
export class SocialGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocialGateway.name);
  private subscriptions: CacheSubscription[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly wsAuthService: WsAuthService,
    private readonly socialService: SocialService,
  ) {}

  onModuleInit() {
    // Two separate subscriptions (one duplicated connection each) rather
    // than one connection subscribed to both channels — simpler than
    // threading a multi-channel subscribe through CacheService for what is,
    // in this app, a negligible number of extra Redis connections.
    this.subscriptions = [
      this.cacheService.subscribe('admin:events', (message) => this.handleAdminEvent(message)),
      this.cacheService.subscribe('social:events', (message) => this.handleSocialEvent(message)),
    ];
  }

  onModuleDestroy() {
    for (const sub of this.subscriptions) sub.unsubscribe();
  }

  private handleAdminEvent(message: string) {
    try {
      const event = JSON.parse(message);
      if (event.type === 'chat_message_deleted' && event.messageId) {
        this.server.emit('globalMessageDeleted', { messageId: event.messageId });
      }
    } catch (e) {
      this.logger.error('Error processing admin:events event', e as Error);
    }
  }

  private handleSocialEvent(message: string) {
    try {
      const event = JSON.parse(message);
      if (event.userId && event.event) {
        this.notifyUser(event.userId, event.event, event.data);
      }
    } catch (e) {
      this.logger.error('Error processing social:events event', e as Error);
    }
  }

  @SubscribeMessage('sendGlobalMessage')
  async handleGlobalMessage(
    @MessageBody() data: { message: string },
    @ConnectedSocket() client: Socket
  ) {
    const userId = client.data.userId;
    const message = data.message.trim().slice(0, 500);
    if (!userId || !message) return;

    const withinLimit = await this.cacheService.checkRateLimit(`ratelimit:chat:${userId}`, 10, 10);
    if (!withinLimit) return;

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });
      if (user) {
        this.server.emit('globalMessage', {
          id: crypto.randomUUID(),
          senderId: userId,
          sender: user.name,
          message,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      this.logger.error('Error handling global message', err);
    }
  }

  async handleConnection(client: Socket) {
    const user = await this.wsAuthService.resolveUser(client);
    if (!user) return;

    try {
      client.data.userId = user.id;
      void client.join(user.id);
      this.logger.log(`User ${user.id} joined their notification room.`);

      const count = await this.cacheService.increment(`presence:${user.id}`);

      // Expire the key after 24h just as a fallback in case of zombie counts
      await this.cacheService.expire(`presence:${user.id}`, 86400);

      if (count === 1) {
        const friends = await this.socialService.getFriends(user.id);
        for (const friend of friends) {
          this.server.to(friend.id).emit('userOnline', { userId: user.id });
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in handleConnection: ${err.message}`);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      try {
        const count = await this.cacheService.decrement(`presence:${userId}`);
        if (count <= 0) {
          // Cleanup just in case it goes negative
          await this.cacheService.delete(`presence:${userId}`);

          const friends = await this.socialService.getFriends(userId);
          for (const friend of friends) {
            this.server.to(friend.id).emit('userOffline', { userId });
          }
        }
      } catch (err: any) {
        this.logger.error(`Error in handleDisconnect: ${err.message}`);
      }
    }
  }

  notifyUser(userId: string, event: string, data: unknown) {
    // Uses the Redis adapter to emit to this specific user across all instances
    this.server.to(userId).emit(event, data);
  }
}
