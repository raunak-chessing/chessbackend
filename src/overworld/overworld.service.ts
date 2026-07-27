import { Injectable, OnModuleInit, OnModuleDestroy, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class OverworldService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;
  private readonly logger = new Logger(OverworldService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      db: 3, // separate db for overworld cache
    });
  }

  async onModuleInit() {
    // Cache the world map in Redis on startup for instant access
    await this.cacheWorldMap();
  }

  onModuleDestroy() {
    this.redisClient.disconnect();
  }

  async cacheWorldMap() {
    const hexes = await this.prisma.worldHex.findMany({
      include: {
        controllingFaction: true,
        structures: true,
      }
    });

    // Store entire map as JSON in Redis for O(1) fetching by clients
    await this.redisClient.set('aethelgard_map', JSON.stringify(hexes));
    console.log(`Cached ${hexes.length} hexes in Redis for Aethelgard Overworld.`);
  }

  async getMapState(userId?: string) {
    let hexes: any[] = [];
    const cachedMap = await this.redisClient.get('aethelgard_map');
    if (cachedMap) {
      hexes = JSON.parse(cachedMap);
    } else {
      hexes = await this.prisma.worldHex.findMany({
        include: {
          controllingFaction: true,
          structures: true,
        }
      });
      await this.redisClient.set('aethelgard_map', JSON.stringify(hexes));
    }

    if (!userId) return hexes;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { factionId: true }
    });

    if (!user || !user.factionId) return hexes;

    const friendlyHexes = hexes.filter(h => h.controllingFactionId === user.factionId);
    if (friendlyHexes.length === 0) return hexes;

    // Apply Fog of War (Radius 2 from any friendly hex, +2 for WATCHTOWER)
    return hexes.map(hex => {
      let minDistance = Infinity;
      for (const fHex of friendlyHexes) {
        const dist = (Math.abs(hex.q - fHex.q) + Math.abs(hex.r - fHex.r) + Math.abs(hex.s - fHex.s)) / 2;
        const hasWatchtower = fHex.structures.some(s => s.type === 'WATCHTOWER');
        const effectiveDist = hasWatchtower ? Math.max(0, dist - 2) : dist;
        if (effectiveDist < minDistance) minDistance = effectiveDist;
      }

      if (minDistance > 2) {
        // Obscured by Fog of War
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
    // Store player position in Redis with a 5 minute expiration (TTL)
    // to keep track of active map players
    await this.redisClient.setex(`overworld:player_pos:${userId}`, 300, JSON.stringify({ q, r }));
  }

  async getPlayerPosition(userId: string) {
    const pos = await this.redisClient.get(`overworld:player_pos:${userId}`);
    if (pos) return JSON.parse(pos);
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

    const costs: Record<string, { gold: number, aetherium: number }> = {
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

  async applySiegeDamage(hexId: string, attackerFactionId: string, damage: number = 100) {
    const hex = await this.prisma.worldHex.findUnique({ 
      where: { id: hexId },
      include: { structures: true }
    });
    if (!hex) return;
    if (hex.controllingFactionId === attackerFactionId) return; // Can't siege own hex

    const hasCitadel = hex.structures.some(s => s.type === 'CITADEL');
    const effectiveMaxHp = hasCitadel ? hex.maxHp * 3 : hex.maxHp;

    let newHp = hex.hp - damage;
    let newControllingFactionId = hex.controllingFactionId;

    if (newHp <= 0) {
      newHp = hex.maxHp; // Reset to base Max HP on capture (Citadel is destroyed)
      newControllingFactionId = attackerFactionId;
      this.logger.log(`Hex ${hexId} captured by faction ${attackerFactionId}!`);
      
      // Destroy all structures on capture
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

    for (const hex of hexes) {
      const users = await this.prisma.user.findMany({
        where: { factionId: hex.controllingFactionId }
      });

      for (const user of users) {
        const hasForge = hex.structures.some(s => s.type === 'AETHERIUM_FORGE');
        const multiplier = hasForge ? 2 : 1;
        const yieldAmount = hex.resourceYield * multiplier;

        if (hex.resourceType === 'GOLD') {
          await this.prisma.playerInventory.updateMany({
            where: { userId: user.id },
            data: { gold: { increment: yieldAmount } }
          });
        } else if (hex.resourceType === 'AETHERIUM') {
          await this.prisma.playerInventory.updateMany({
            where: { userId: user.id },
            data: { aetherium: { increment: yieldAmount } }
          });
        }
      }
    }
  }
}
