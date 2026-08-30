import { Test, TestingModule } from '@nestjs/testing';
import type { Socket } from 'socket.io';
import { WsAuthService } from './ws-auth.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { Logger } from '@nestjs/common';

function makeClient(opts: { token?: string; cookie?: string }): Socket {
  return {
    handshake: {
      auth: opts.token ? { token: opts.token } : {},
      headers: opts.cookie ? { cookie: opts.cookie } : {},
    },
  } as unknown as Socket;
}

describe('WsAuthService', () => {
  let service: WsAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [WsAuthService, getPrismaMockProvider()],
    }).compile();

    service = module.get<WsAuthService>(WsAuthService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  describe('extractSessionToken', () => {
    it('prefers the handshake auth token over any cookie', () => {
      const client = makeClient({ token: 'tok-from-auth', cookie: 'better-auth.session_token=tok-from-cookie' });
      expect(service.extractSessionToken(client)).toBe('tok-from-auth');
    });

    it('reads the token from a plain session cookie', () => {
      const client = makeClient({ cookie: 'better-auth.session_token=abc123' });
      expect(service.extractSessionToken(client)).toBe('abc123');
    });

    it('reads the token from a __Secure- prefixed cookie (HTTPS deployments)', () => {
      const client = makeClient({ cookie: '__Secure-better-auth.session_token=abc123' });
      expect(service.extractSessionToken(client)).toBe('abc123');
    });

    it('reads the token alongside other cookies', () => {
      const client = makeClient({ cookie: 'theme=dark; better-auth.session_token=abc123; lang=en' });
      expect(service.extractSessionToken(client)).toBe('abc123');
    });

    it('returns undefined when there is no token or cookie', () => {
      const client = makeClient({});
      expect(service.extractSessionToken(client)).toBeUndefined();
    });
  });

  describe('resolveUser', () => {
    it('returns null when there is no token', async () => {
      const client = makeClient({});
      expect(await service.resolveUser(client)).toBeNull();
      expect(prismaMock.session.findUnique).not.toHaveBeenCalled();
    });

    it('returns the user for a valid, unexpired session', async () => {
      const user = { id: 'u1', name: 'Alice', email: 'alice@example.com' };
      prismaMock.session.findUnique.mockResolvedValueOnce({
        expiresAt: new Date(Date.now() + 60_000),
        user,
      } as any);

      const client = makeClient({ token: 'tok' });
      expect(await service.resolveUser(client)).toEqual(user);
    });

    it('returns null for an expired session', async () => {
      prismaMock.session.findUnique.mockResolvedValueOnce({
        expiresAt: new Date(Date.now() - 60_000),
        user: { id: 'u1' },
      } as any);

      const client = makeClient({ token: 'tok' });
      expect(await service.resolveUser(client)).toBeNull();
    });

    it('returns null when no session is found', async () => {
      prismaMock.session.findUnique.mockResolvedValueOnce(null);
      const client = makeClient({ token: 'tok' });
      expect(await service.resolveUser(client)).toBeNull();
    });

    it('swallows lookup errors and returns null', async () => {
      prismaMock.session.findUnique.mockRejectedValueOnce(new Error('db down'));
      const client = makeClient({ token: 'tok' });
      expect(await service.resolveUser(client)).toBeNull();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });
});
