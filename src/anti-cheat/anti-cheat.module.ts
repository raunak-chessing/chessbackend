import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AntiCheatService } from './anti-cheat.service';
import { AntiCheatProcessor } from './anti-cheat.processor';
import { AntiCheatProducer } from './anti-cheat.producer';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [
    PrismaModule,
    AnalysisModule,
    BullModule.registerQueue({
      name: 'anti-cheat-queue',
    }),
  ],
  providers: [AntiCheatService, AntiCheatProcessor, AntiCheatProducer],
  exports: [AntiCheatProducer],
})
export class AntiCheatModule {}
