import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

/**
 * A second Prisma client for read-heavy, lag-tolerant queries (leaderboards,
 * tournament standings, profile lookups). Points at DATABASE_REPLICA_URL when
 * set, and transparently falls back to the primary DATABASE_URL otherwise, so
 * wiring a call site to this client is safe today and becomes a real replica
 * read the moment DATABASE_REPLICA_URL is configured.
 *
 * Never use this for anything touching live game state — replication lag
 * would surface as a stale read there, which is a correctness bug, not just
 * a performance tradeoff.
 */
@Injectable()
export class PrismaReadService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaReadService.name);
  private pool: pg.Pool;

  constructor() {
    const replicaUrl = process.env.DATABASE_REPLICA_URL || process.env.DATABASE_URL;
    const pool = new pg.Pool({
      connectionString: replicaUrl,
      max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? '5000', 10),
      statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '15000', 10),
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    if (!process.env.DATABASE_REPLICA_URL) {
      this.logger.log(
        'DATABASE_REPLICA_URL is not set; read-replica queries are served from the primary database.',
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
