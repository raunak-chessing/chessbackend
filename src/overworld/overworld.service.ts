import { Injectable, OnModuleInit, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class OverworldService implements OnModuleInit {
  private readonly redisClient: Redis;
  private readonly logger = new Logger(OverworldService.name);

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {
    this.redisClient = this.redisService.getClient();
  }

  async onModuleInit() {
    await this.cacheWorldMap();
  }

  async cacheWorldMap() {
    const hexes = await this.prisma.worldHex.findMany({
      include: {
        controllingFaction: true,
        structures: true,
      }
    });

    await this.redisClient.set('aethelgard_map', JSON.stringify(hexes));
    this.logger.log(`Cached ${hexes.length} hexes in Redis for Aethelgard Overworld.`);
  }

  async getMapState(userId?: string) {
    let hexes: Record<string, unknown>[] = [];
    const cachedMap = await this.redisClient.get('aethelgard_map');
    if (cachedMap) {
      hexes = JSON.parse(cachedMap) as Record<string, unknown>[];
    } else {
      hexes = await this.prisma.worldHex.findMany({
        include: {
          controllingFaction: true,
          structures: true,
        }
      }) as unknown as Record<string, unknown>[];
      await this.redisClient.set('aethelgard_map', JSON.stringify(hexes));
    }

    if (!userId) return hexes;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { factionId: true }
    });

    if (!user || !user.factionId) return hexes;

    const friendlyHexes = hexes.filter(h => (h as Record<string, unknown>).controllingFactionId === user.factionId);
    if (friendlyHexes.length === 0) return hexes;

    return hexes.map(hex => {
      let minDistance = Infinity;
      for (const fHex of friendlyHexes) {
        const hq = hex.q as number;
        const hr = hex.r as number;
        const hs = hex.s as number;
        const fq = fHex.q as number;
        const fr = fHex.r as number;
        const fs = fHex.s as number;
        const dist = (Math.abs(hq - fq) + Math.abs(hr - fr) + Math.abs(hs - fs)) / 2;
        const structures = fHex.structures as { type: string }[];
        const hasWatchtower = structures.some(s => s.type === 'WATCHTOWER');
        const effectiveDist = hasWatchtower ? Math.max(0, dist - 2) : dist;
        if (effectiveDist < minDistance) minDistance = effectiveDist;
      }

      if (minDistance > 2) {
        return {
          ...hex,
          terrain: 'UNKNOWN',
          controllingFactionId: null,
          controllingFaction: null,
          structures: []
        };
      }
      return hex;
    });
  }

  async setPlayerPosition(userId: string, q: number, r: number) {
    await this.redisClient.setex(`overworld:player_pos:${userId}`, 300, JSON.stringify({ q, r }));
  }

  async getPlayerPosition(userId: string) {
    const pos = await this.redisClient.get(`overworld:player_pos:${userId}`);
    if (pos) return JSON.parse(pos) as { q: number; r: number };
    return null;
  }

  async buildStructure(userId: string, hexId: string, structureType: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.factionId) throw new BadRequestException('Not in a faction');
    if (user.factionRank !== 'WARLORD' && user.factionRank !== 'COMMANDER') {
      throw new BadRequestException('Only Warlords and Commanders can build structures');
    }

    const hex = await this.prisma.worldHex.findUnique({ where: { id: hexId } });
    if (hex?.controllingFactionId !== user.factionId) {
      throw new BadRequestException('Cannot build on enemy or neutral hex');
    }

    const costs: Record<string, { gold: number; aetherium: number }> = {
      'WATCHTOWER': { gold: 5000, aetherium: 100 },
      'CITADEL': { gold: 20000, aetherium: 500 },
      'AETHERIUM_FORGE': { gold: 10000, aetherium: 300 }
    };

    const cost = costs[structureType];
    if (!cost) throw new BadRequestException('Invalid structure type');

    const treasury = await this.prisma.factionTreasury.findUnique({ where: { factionId: user.factionId } });
    if (!treasury || treasury.gold < cost.gold || treasury.aetherium < cost.aetherium) {
      throw new BadRequestException('Insufficient faction treasury funds');
    }

    await this.prisma.$transaction([
      this.prisma.factionTreasury.update({
        where: { factionId: user.factionId },
        data: { gold: { decrement: cost.gold }, aetherium: { decrement: cost.aetherium } }
      }),
      this.prisma.structure.create({
        data: { type: structureType, hexId }
      })
    ]);

    await this.cacheWorldMap();
    return { success: true };
  }

  private static readonly SIEGE_COST = { gold: 500, aetherium: 10 };
  private static readonly SIEGE_COOLDOWN_SECONDS = 30;

  async siegeHex(userId: string, hexId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.factionId) throw new BadRequestException('Not in a faction');

    const cooldownKey = `overworld:siege_cooldown:${userId}:${hexId}`;
    const onCooldown = await this.redisClient.exists(cooldownKey);
    if (onCooldown) throw new BadRequestException('This hex was sieged too recently, wait before attacking it again');

    const { gold, aetherium } = OverworldService.SIEGE_COST;
    const treasury = await this.prisma.factionTreasury.findUnique({ where: { factionId: user.factionId } });
    if (!treasury || treasury.gold < gold || treasury.aetherium < aetherium) {
      throw new BadRequestException('Insufficient faction treasury funds to siege');
    }

    await this.prisma.factionTreasury.update({
      where: { factionId: user.factionId },
      data: { gold: { decrement: gold }, aetherium: { decrement: aetherium } },
    });
    await this.redisClient.setex(cooldownKey, OverworldService.SIEGE_COOLDOWN_SECONDS, '1');

    await this.applySiegeDamage(hexId, user.factionId, 100);
    return { success: true };
  }

  async applySiegeDamage(hexId: string, attackerFactionId: string, damage: number = 100) {
    const hex = await this.prisma.worldHex.findUnique({
      where: { id: hexId },
      include: { structures: true }
    });
    if (!hex) return;
    if (hex.controllingFactionId === attackerFactionId) return;

    const hasCitadel = hex.structures.some(s => s.type === 'CITADEL');
    const effectiveDamage = hasCitadel ? Math.ceil(damage / 2) : damage;

    let newHp = hex.hp - effectiveDamage;
    let newControllingFactionId = hex.controllingFactionId;

    if (newHp <= 0) {
      newHp = hex.maxHp;
      newControllingFactionId = attackerFactionId;
      this.logger.log(`Hex ${hexId} captured by faction ${attackerFactionId}!`);
      
      await this.prisma.structure.deleteMany({ where: { hexId } });
    }

    await this.prisma.worldHex.update({
      where: { id: hexId },
      data: { hp: newHp, controllingFactionId: newControllingFactionId }
    });

    await this.cacheWorldMap();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async processHexResources() {
    this.logger.log('Processing passive resources from Overworld Hexes...');

    const hexes = await this.prisma.worldHex.findMany({
      where: { controllingFactionId: { not: null }, resourceType: { not: null }, resourceYield: { gt: 0 } },
      include: { structures: true }
    });

    const factionGoldYield: Record<string, number> = {};
    const factionAetheriumYield: Record<string, number> = {};

    for (const hex of hexes) {
      if (!hex.controllingFactionId || !hex.resourceType) continue;

      const hasForge = hex.structures.some(s => s.type === 'AETHERIUM_FORGE');
      const multiplier = hasForge ? 2 : 1;
      const yieldAmount = hex.resourceYield * multiplier;

      if (hex.resourceType === 'GOLD') {
        factionGoldYield[hex.controllingFactionId] = (factionGoldYield[hex.controllingFactionId] || 0) + yieldAmount;
      } else if (hex.resourceType === 'AETHERIUM') {
        factionAetheriumYield[hex.controllingFactionId] = (factionAetheriumYield[hex.controllingFactionId] || 0) + yieldAmount;
      }
    }

    for (const [factionId, goldAmount] of Object.entries(factionGoldYield)) {
      await this.prisma.$executeRaw`
        UPDATE "PlayerInventory" SET gold = gold + ${goldAmount}
        WHERE "userId" IN (SELECT id FROM "User" WHERE "factionId" = ${factionId})
      `;
    }

    for (const [factionId, aetheriumAmount] of Object.entries(factionAetheriumYield)) {
      await this.prisma.$executeRaw`
        UPDATE "PlayerInventory" SET aetherium = aetherium + ${aetheriumAmount}
        WHERE "userId" IN (SELECT id FROM "User" WHERE "factionId" = ${factionId})
      `;
    }

    this.logger.log(`Resource distribution complete. ${Object.keys(factionGoldYield).length} factions received gold, ${Object.keys(factionAetheriumYield).length} factions received aetherium.`);
  }
}
