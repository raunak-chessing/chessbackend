import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminGuard } from './admin.guard';

function contextWithUser(user: { id: string; email: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const makeGuard = (adminEmails: string | undefined, role: 'USER' | 'ADMIN' | null = 'USER') => {
    const configService = {
      get: jest.fn().mockReturnValue(adminEmails),
    } as unknown as ConfigService;
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(role === null ? null : { role }),
      },
    } as any;
    return { guard: new AdminGuard(configService, prisma), prisma };
  };

  it('allows a request from an allowlisted email without querying the database', async () => {
    const { guard, prisma } = makeGuard('admin@chessing.local');
    const allowed = await guard.canActivate(
      contextWithUser({ id: 'u1', email: 'admin@chessing.local' }),
    );
    expect(allowed).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows any email in a comma-separated allowlist', async () => {
    const { guard } = makeGuard('admin@chessing.local, ops@chessing.local');
    await expect(
      guard.canActivate(contextWithUser({ id: 'u2', email: 'ops@chessing.local' })),
    ).resolves.toBe(true);
  });

  it('allows a non-allowlisted user whose role is ADMIN in the database', async () => {
    const { guard, prisma } = makeGuard('admin@chessing.local', 'ADMIN');
    const allowed = await guard.canActivate(
      contextWithUser({ id: 'u3', email: 'promoted-admin@local' }),
    );
    expect(allowed).toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u3' },
      select: { role: true },
    });
  });

  it('rejects a non-admin email whose role is USER', async () => {
    const { guard } = makeGuard('admin@chessing.local', 'USER');
    await expect(
      guard.canActivate(contextWithUser({ id: 'u4', email: 'user@local' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user', async () => {
    const { guard } = makeGuard('admin@chessing.local');
    await expect(guard.canActivate(contextWithUser(undefined))).rejects.toThrow(ForbiddenException);
  });

  it('falls back to the default admin email when ADMIN_EMAILS is unset', async () => {
    const { guard } = makeGuard(undefined, 'USER');
    await expect(
      guard.canActivate(contextWithUser({ id: 'u5', email: 'admin@chessing.local' })),
    ).resolves.toBe(true);
  });
});
