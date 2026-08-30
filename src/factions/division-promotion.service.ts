import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const TIERS = ['WOOD', 'STONE', 'BRONZE', 'SILVER', 'CRYSTAL', 'ELITE', 'CHAMPION', 'LEGEND'];

/** League division bootstrap, querying, and the weekly promotion/relegation sweep. */
@Injectable()
export class DivisionPromotionService {
  private readonly logger = new Logger(DivisionPromotionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureDivisions(): Promise<void> {
    const defaultDivision = await this.prisma.userDivision.findFirst({ where: { tier: 'WOOD' } });
    if (!defaultDivision) {
      const seasonEnd = new Date();
      seasonEnd.setDate(seasonEnd.getDate() + (7 - seasonEnd.getDay())); // Next Sunday
      await this.prisma.userDivision.create({
        data: { tier: 'WOOD', seasonEnd },
      });
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async getCurrentDivisions() {
    const divisions = await this.prisma.userDivision.findMany({
      where: { seasonEnd: { gt: new Date() } },
      include: {
        users: {
          select: { id: true, name: true, factionContribution: true, rating: true },
          orderBy: { factionContribution: 'desc' },
          take: 50, // Limit to top 50 in each division.
        },
      },
      orderBy: { tier: 'asc' },
    });

    return divisions;
  }

  /**
   * The weekly promotion/relegation algorithm. Note: nothing in production
   * currently triggers this (no cron, no controller endpoint) — it's
   * complete and tested but effectively dead code, same as it was before
   * this refactor. Preserved as-is; wiring it up is a product decision,
   * not something this structural pass should do unprompted.
   */
  async processDivisionPromotions(): Promise<void> {
    this.logger.log('Processing weekly League Division promotions...');

    const divisions = await this.prisma.userDivision.findMany({
      include: { users: { orderBy: { factionContribution: 'desc' } } },
    });

    const newSeasonEnd = new Date();
    newSeasonEnd.setDate(newSeasonEnd.getDate() + 7);

    // Create new division instances for the next week.
    const newDivisions = await Promise.all(
      TIERS.map((tier) => this.prisma.userDivision.create({ data: { tier, seasonEnd: newSeasonEnd } })),
    );

    const tierToIdMap = new Map(newDivisions.map((d) => [d.tier, d.id]));

    // Group users by their target division to batch updates.
    const updatesByDivision: Record<string, string[]> = {};

    for (const division of divisions) {
      const users = division.users;
      if (users.length === 0) continue;

      const currentTierIndex = TIERS.indexOf(division.tier);

      const promoteCount = Math.max(1, Math.floor(users.length * 0.2));
      const relegateCount = Math.max(1, Math.floor(users.length * 0.2));

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        let nextTierIndex = currentTierIndex;

        if (i < promoteCount && currentTierIndex < TIERS.length - 1) {
          nextTierIndex++;
        } else if (i >= users.length - relegateCount && currentTierIndex > 0) {
          nextTierIndex--;
        }

        const nextDivisionId = tierToIdMap.get(TIERS[nextTierIndex]);
        if (nextDivisionId) {
          if (!updatesByDivision[nextDivisionId]) {
            updatesByDivision[nextDivisionId] = [];
          }
          updatesByDivision[nextDivisionId].push(user.id);
        }
      }
    }

    // Execute bulk updates.
    for (const [nextDivisionId, userIds] of Object.entries(updatesByDivision)) {
      if (userIds.length > 0) {
        await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            divisionId: nextDivisionId,
            factionContribution: 0,
          },
        });
      }
    }
  }
}
