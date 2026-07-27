import { Injectable, OnModuleInit, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class FactionsService implements OnModuleInit {
  private readonly logger = new Logger(FactionsService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedFactions();
    await this.ensureActiveEra();
    await this.ensureDivisions();
  }

  private async ensureDivisions() {
    const defaultDivision = await this.prisma.userDivision.findFirst({ where: { tier: 'WOOD' } });
    if (!defaultDivision) {
      const seasonEnd = new Date();
      seasonEnd.setDate(seasonEnd.getDate() + (7 - seasonEnd.getDay())); // Next Sunday
      await this.prisma.userDivision.create({
        data: { tier: 'WOOD', seasonEnd }
      });
    }
  }

  private async seedFactions() {
    const factions = [
      {
        name: "Iron Syndicate",
        description: "Aggressive, tactical, and ruthlessly efficient. +10% Gold from Quests.",
        colorTheme: "red",
        trait: "GOLD_BONUS"
      },
      {
        name: "Celestial Order",
        description: "Upholders of strategy, patience, and absolute control. +10% Aetherium generation.",
        colorTheme: "blue",
        trait: "AETHERIUM_BONUS"
      },
      {
        name: "Voidborn",
        description: "Stalwart defenders relying on unbreakable defense. Unlocks dark cosmetics.",
        colorTheme: "amber", // Using amber to match their purplish/dark vibe in UI usually, but mapping exists
        trait: "COSMETIC_UNLOCK"
      },
    ];

    for (const f of factions) {
      await this.prisma.faction.upsert({
        where: { name: f.name },
        update: { trait: f.trait, description: f.description },
        create: {
          name: f.name,
          description: f.description,
          colorTheme: f.colorTheme,
          trait: f.trait,
          totalScore: 0,
        },
      });
    }
  }

  private async ensureActiveEra() {
    const activeEra = await this.prisma.factionEra.findFirst({
      where: { endDate: null },
      orderBy: { eraNumber: 'desc' }
    });

    if (!activeEra) {
      await this.startNewEra();
    }
  }

  async startNewEra() {
    const lastEra = await this.prisma.factionEra.findFirst({
      orderBy: { eraNumber: 'desc' }
    });
    
    const newEraNumber = lastEra ? lastEra.eraNumber + 1 : 1;

    await this.prisma.factionEra.create({
      data: {
        eraNumber: newEraNumber,
        startDate: new Date(),
      }
    });

    // Reset all faction scores and user contributions
    await this.prisma.faction.updateMany({ data: { totalScore: 0 } });
    await this.prisma.user.updateMany({ data: { factionContribution: 0, factionRank: 'GRUNT' } });
    
    this.logger.log(`Started Faction Era ${newEraNumber}`);
  }

  @Cron(CronExpression.EVERY_WEEK)
  async processDivisionPromotions() {
    this.logger.log('Processing weekly League Division promotions...');
    
    const divisions = await this.prisma.userDivision.findMany({
      include: { users: { orderBy: { factionContribution: 'desc' } } }
    });

    const TIERS = ['WOOD', 'STONE', 'BRONZE', 'SILVER', 'CRYSTAL', 'ELITE', 'CHAMPION', 'LEGEND'];

    const newSeasonEnd = new Date();
    newSeasonEnd.setDate(newSeasonEnd.getDate() + 7);

    // Create new division instances for the next week
    const newDivisions = await Promise.all(TIERS.map(tier => 
      this.prisma.userDivision.create({
        data: { tier, seasonEnd: newSeasonEnd }
      })
    ));

    const tierToIdMap = new Map(newDivisions.map(d => [d.tier, d.id]));

    // Group users by their target division to batch updates
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

    // Execute bulk updates
    for (const [nextDivisionId, userIds] of Object.entries(updatesByDivision)) {
      if (userIds.length > 0) {
        await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            divisionId: nextDivisionId,
            factionContribution: 0
          }
        });
      }
    }
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async distributeEraRewards() {
    this.logger.log('Ending current Era and distributing rewards...');
    
    const activeEra = await this.prisma.factionEra.findFirst({
      where: { endDate: null },
      orderBy: { eraNumber: 'desc' }
    });

    if (!activeEra) return;

    // Find winning faction
    const factions = await this.getAllFactions();
    if (factions.length === 0) return;
    
    const winner = factions[0]; // Ordered by score desc

    await this.prisma.factionEra.update({
      where: { id: activeEra.id },
      data: { 
        endDate: new Date(),
        winnerId: winner.id 
      }
    });

    // Reward active players of the winning faction
    const winningUsers = await this.prisma.user.findMany({
      where: { factionId: winner.id, factionContribution: { gt: 100 } }
    });

    // Grant massive Aetherium to winners
    for (const user of winningUsers) {
      await this.prisma.playerInventory.upsert({
        where: { userId: user.id },
        create: { userId: user.id, aetherium: 500, gold: 5000 },
        update: { aetherium: { increment: 500 }, gold: { increment: 5000 } }
      });
    }

    await this.startNewEra();
  }

  async getAllFactions() {
    return this.prisma.faction.findMany({
      orderBy: { totalScore: 'desc' },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });
  }

  async joinFaction(userId: string, factionId: string) {
    const faction = await this.prisma.faction.findUnique({ where: { id: factionId } });
    if (!faction) throw new NotFoundException('Faction not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.factionId) throw new BadRequestException('User already belongs to a faction');

    return this.prisma.user.update({
      where: { id: userId },
      data: { factionId, factionRank: 'GRUNT', factionContribution: 0 },
    });
  }

  async incrementFactionScoreForUser(userId: string, opponentElo: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.factionId) return null;

    // Dynamic Elo-weighted contribution
    // Base 10 points. +1 point for every 50 Elo the opponent has above 1000.
    const basePoints = 10;
    const bonus = Math.max(0, Math.floor((opponentElo - 1000) / 50));
    const points = basePoints + bonus;

    // Calculate new rank
    const newContrib = user.factionContribution + points;
    let newRank = 'GRUNT';
    if (newContrib > 1000) newRank = 'KNIGHT';
    if (newContrib > 5000) newRank = 'COMMANDER';
    if (newContrib > 20000) newRank = 'WARLORD';

    await this.prisma.user.update({
      where: { id: userId },
      data: { 
        factionContribution: newContrib,
        factionRank: newRank 
      }
    });

    return this.prisma.faction.update({
      where: { id: user.factionId },
      data: { totalScore: { increment: points } },
    });
  }
}
