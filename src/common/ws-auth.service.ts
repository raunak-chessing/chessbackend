import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SESSION_COOKIE_PATTERN = /(?:__Secure-)?better-auth\.session_token=([^;]+)/;

/**
 * Resolves the authenticated user for a Socket.IO connection from the
 * better-auth session token — either the handshake `auth.token` payload or
 * the `better-auth.session_token` cookie.
 *
 * This was previously copy-pasted into every WS gateway's handleConnection
 * (puzzle-battle, social, overworld, streamer), and had already drifted:
 * streamer's copy was missing both the `__Secure-` cookie-prefix handling
 * and the `-`/`_` separator variant, meaning authenticated users on HTTPS
 * silently failed to authenticate there. One implementation now.
 *
 * This only resolves *who* the caller is — each gateway keeps its own
 * policy for what to do with the result (guest fallback, silent anonymous
 * access, hard disconnect on failure, etc.), since those policies genuinely
 * differ per gateway.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  extractSessionToken(client: Socket): string | undefined {
    const fromHandshake = (client.handshake.auth as Record<string, unknown>)?.token as
      | string
      | undefined;
    if (fromHandshake) return fromHandshake;

    const cookie = client.handshake.headers.cookie;
    if (!cookie) return undefined;

    return cookie.match(SESSION_COOKIE_PATTERN)?.[1];
  }

  async resolveUser(client: Socket): Promise<User | null> {
    const token = this.extractSessionToken(client);
    if (!token) return null;

    try {
      const session = await this.prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });

      if (session && session.expiresAt > new Date()) {
        return session.user;
      }
      return null;
    } catch (err) {
      this.logger.error(`Failed to resolve WS session: ${(err as Error).message}`);
      return null;
    }
  }
}
