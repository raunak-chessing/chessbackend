import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
@Injectable()
export class SocialGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocialGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleConnection(client: Socket) {
    let sessionToken = (client.handshake.auth as Record<string, unknown>)
      ?.token as string;
    if (!sessionToken && client.handshake.headers.cookie) {
      const match = client.handshake.headers.cookie.match(
        /better-auth\.session-token=([^;]+)/,
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
          // Join a Redis-backed room for this user to receive targeted notifications
          void client.join(session.user.id);
          this.logger.log(`User ${session.user.id} joined their notification room.`);
          // (Presence fan-out would go here to notify only friends)
        }
      } catch (err: any) {
        this.logger.error(`Error in handleConnection: ${err.message}`);
      }
    }
  }

  handleDisconnect(client: Socket) {
    // Rooms are automatically left on disconnect
  }

  notifyUser(userId: string, event: string, data: unknown) {
    // Uses the Redis adapter to emit to this specific user across all instances
    this.server.to(userId).emit(event, data);
  }
}
