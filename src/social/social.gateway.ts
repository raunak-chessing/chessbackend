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
import { RedisService } from '../redis/redis.service';
import { SocialService } from './social.service';
import { checkRateLimit } from '../common/rate-limit.util';
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
  private eventSubscriber: ReturnType<RedisService['getClient']> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly socialService: SocialService,
  ) {}

  onModuleInit() {
    this.eventSubscriber = this.redisService.getClient().duplicate();
    this.eventSubscriber
      .subscribe('admin:events', 'social:events')
      .catch((err) => this.logger.error('Failed to subscribe to social/admin events', err));

    this.eventSubscriber.on('message', (channel, message) => {
      try {
        const event = JSON.parse(message);
        if (channel === 'admin:events') {
          if (event.type === 'chat_message_deleted' && event.messageId) {
            this.server.emit('globalMessageDeleted', { messageId: event.messageId });
          }
        } else if (channel === 'social:events') {
          if (event.userId && event.event) {
            this.notifyUser(event.userId, event.event, event.data);
          }
        }
      } catch (e) {
        this.logger.error(`Error processing ${channel} event`, e as Error);
      }
    });
  }

  onModuleDestroy() {
    this.eventSubscriber?.disconnect();
  }

  @SubscribeMessage('sendGlobalMessage')
  async handleGlobalMessage(
    @MessageBody() data: { message: string },
    @ConnectedSocket() client: Socket
  ) {
    const userId = client.data.userId;
    const message = data.message.trim().slice(0, 500);
    if (!userId || !message) return;

    const withinLimit = await checkRateLimit(this.redisService.getClient(), `ratelimit:chat:${userId}`, 10, 10);
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
    let sessionToken = (client.handshake.auth as Record<string, unknown>)
      ?.token as string;
    if (!sessionToken && client.handshake.headers.cookie) {
      const match = client.handshake.headers.cookie.match(
        /(?:__Secure-)?better-auth\.session_token=([^;]+)/,
      );
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
          const userId = session.user.id;
          client.data.userId = userId;
          void client.join(userId);
          this.logger.log(`User ${userId} joined their notification room.`);
          
          const redis = this.redisService.getClient();
          const count = await redis.incr(`presence:${userId}`);
          
          // Expire the key after 24h just as a fallback in case of zombie counts
          await redis.expire(`presence:${userId}`, 86400);

          if (count === 1) {
            const friends = await this.socialService.getFriends(userId);
            for (const friend of friends) {
              this.server.to(friend.id).emit('userOnline', { userId });
            }
          }
        }
      } catch (err: any) {
        this.logger.error(`Error in handleConnection: ${err.message}`);
      }
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      try {
        const redis = this.redisService.getClient();
        const count = await redis.decr(`presence:${userId}`);
        if (count <= 0) {
          // Cleanup just in case it goes negative
          await redis.del(`presence:${userId}`);
          
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
