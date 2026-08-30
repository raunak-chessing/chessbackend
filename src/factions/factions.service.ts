import { Injectable, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EraLifecycleService } from './era-lifecycle.service';
import { DivisionPromotionService } from './division-promotion.service';

@Injectable()
export class FactionsService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private readonly eraLifecycleService: EraLifecycleService,
    private readonly divisionPromotionService: DivisionPromotionService,
  ) {}

  async onModuleInit() {
    await this.seedFactions();
    await this.eraLifecycleService.ensureActiveEra();
    await this.divisionPromotionService.ensureDivisions();
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
