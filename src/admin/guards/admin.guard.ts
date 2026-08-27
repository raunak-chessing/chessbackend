import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../../types';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    const email = request.user?.email;

    if (!userId || !email) {
      throw new ForbiddenException('Administrator access required');
    }

    if (this.getAdminEmails().includes(email)) {
      return true;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role === 'ADMIN') {
      return true;
    }

    throw new ForbiddenException('Administrator access required');
  }

  private getAdminEmails(): string[] {
    const raw = this.configService.get<string>('ADMIN_EMAILS') || 'admin@chessing.local';
    return raw.split(',').map((e) => e.trim()).filter(Boolean);
  }
}
