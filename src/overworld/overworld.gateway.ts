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
import { OverworldService } from './overworld.service';
import { UsePipes, ValidationPipe, UseFilters, Logger } from '@nestjs/common';
import { IsNumber, IsNotEmpty } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { checkRateLimit } from '../common/rate-limit.util';

class MoveAvatarDto {
  @IsNumber()
  @IsNotEmpty()
  q: number;

  @IsNumber()
  @IsNotEmpty()
  r: number;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/overworld',
})
@UsePipes(new ValidationPipe({ transform: true }))
export class OverworldGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OverworldGateway.name);

  constructor(
    private readonly overworldService: OverworldService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

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

    if (!sessionToken) return;

    try {
      const session = await this.prisma.session.findUnique({
        where: { token: sessionToken },
        include: { user: true },
      });

      if (session && session.expiresAt > new Date()) {
        client.data.userId = session.user.id;
      }
    } catch (err: any) {
      this.logger.error(`Error in handleConnection: ${err.message}`);
    }
  }

  handleDisconnect(client: Socket) {}

  @SubscribeMessage('joinOverworld')
  async handleJoin(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (!userId) return;

    const pos = await this.overworldService.getPlayerPosition(userId) || { q: 0, r: 0 };
    client.emit('spawned', pos);
  }

  @SubscribeMessage('moveAvatar')
  async handleMove(
    @MessageBody() data: MoveAvatarDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    const withinLimit = await checkRateLimit(this.redisService.getClient(), `ratelimit:avatar_move:${userId}`, 20, 5);
    if (!withinLimit) return;

    await this.overworldService.setPlayerPosition(userId, data.q, data.r);

    // Broadcast movement to all other players in the overworld
    this.server.emit('avatarMoved', { userId, q: data.q, r: data.r });
  }
}
