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
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { IsNumber, IsNotEmpty } from 'class-validator';
import { WsAuthService } from '../common/ws-auth.service';
import { CacheService } from '../redis/cache.service';

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

  constructor(
    private readonly overworldService: OverworldService,
    private readonly wsAuthService: WsAuthService,
    private readonly cacheService: CacheService,
  ) {}

  async handleConnection(client: Socket) {
    const user = await this.wsAuthService.resolveUser(client);
    if (user) {
      client.data.userId = user.id;
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

    const withinLimit = await this.cacheService.checkRateLimit(`ratelimit:avatar_move:${userId}`, 20, 5);
    if (!withinLimit) return;

    await this.overworldService.setPlayerPosition(userId, data.q, data.r);

    // Broadcast movement to all other players in the overworld
    this.server.emit('avatarMoved', { userId, q: data.q, r: data.r });
  }
}
