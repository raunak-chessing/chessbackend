import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { LlmNarrativeService } from './llm-narrative.service';
import { LlmNarrativeProcessor } from './llm-narrative.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'llm-narrative-queue',
    }),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, LlmNarrativeService, LlmNarrativeProcessor],
  exports: [AnalysisService, LlmNarrativeService],
})
export class AnalysisModule {}
