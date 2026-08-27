import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const RETENTION_DAYS_BY_LEVEL: Record<string, number> = {
  info: 7,
  warn: 30,
  error: 90,
};

@Injectable()
export class LogCleanupService {
  private readonly logger = new Logger(LogCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Run every day at midnight
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.log('Starting daily log cleanup...');

    for (const [level, retentionDays] of Object.entries(RETENTION_DAYS_BY_LEVEL)) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);

      try {
        const result = await this.prisma.systemLog.deleteMany({
          where: {
            level,
            createdAt: {
              lt: cutoff,
            },
          },
        });

        this.logger.log(`Cleaned up ${result.count} old ${level} logs.`);
      } catch (error) {
        this.logger.error(`Failed to clean up ${level} logs`, error);
      }
    }
  }
}
