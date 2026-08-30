import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** Faction Era start/end and the monthly winner-reward payout. */
@Injectable()
export class EraLifecycleService {
  private readonly logger = new Logger(EraLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureActiveEra(): Promise<void> {
    const activeEra = await this.prisma.factionEra.findFirst({
      where: { endDate: null },
      orderBy: { eraNumber: 'desc' },
    });

    if (!activeEra) {
      await this.startNewEra();
    }
  }

  async startNewEra(): Promise<void> {
    const lastEra = await this.prisma.factionEra.findFirst({
      orderBy: { eraNumber: 'desc' },
    });

    const newEraNumber = lastEra ? lastEra.eraNumber + 1 : 1;

    try {
      await this.prisma.factionEra.create({
        data: {
          eraNumber: newEraNumber,
          startDate: new Date(),
        },
      });
      // Reset all faction scores and user contributions.
      await this.prisma.faction.updateMany({ data: { totalScore: 0 } });
      await this.prisma.user.updateMany({ data: { factionContribution: 0, factionRank: 'GRUNT' } });

      this.logger.log(`Started Faction Era ${newEraNumber}`);
    } catch (e: any) {
      if (e.code === 'P2002') {
        this.logger.log(`Era ${newEraNumber} already started by another process.`);
      } else {
        throw e;
      }
    }
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async distributeEraRewards(): Promise<void> {
    this.logger.log('Ending current Era and distributing rewards...');

    const activeEra = await this.prisma.factionEra.findFirst({
      where: { endDate: null },
      orderBy: { eraNumber: 'desc' },
    });
    if (!activeEra) return;

    const winner = await this.prisma.faction.findFirst({ orderBy: { totalScore: 'desc' } });
    if (!winner) return;

    await this.prisma.factionEra.update({
      where: { id: activeEra.id },
      data: {
        endDate: new Date(),
        winnerId: winner.id,
      },
    });

    // Reward active players of the winning faction.
    const winningUsers = await this.prisma.user.findMany({
      where: { factionId: winner.id, factionContribution: { gt: 100 } },
    });

    // Grant massive Aetherium to winners.
    for (const user of winningUsers) {
      await this.prisma.playerInventory.upsert({
        where: { userId: user.id },
        create: { userId: user.id, aetherium: 500, gold: 5000 },
        update: { aetherium: { increment: 500 }, gold: { increment: 5000 } },
      });
    }

    await this.startNewEra();
  }
}
