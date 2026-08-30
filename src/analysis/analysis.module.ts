import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { LlmNarrativeService } from './llm-narrative.service';
import { LlmNarrativeProcessor } from './llm-narrative.processor';
import { ChessReplayService } from './chess-replay.service';
import { MoveClassifierService } from './move-classifier.service';
import { ChessApiEngineProvider } from './providers/chess-api-engine.provider';
import { CachedEngineAnalysisProvider } from './providers/cached-engine-analysis.provider';
import {
  ENGINE_ANALYSIS_PROVIDER,
  RAW_ENGINE_ANALYSIS_PROVIDER,
} from './providers/engine-analysis-provider.interface';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'llm-narrative-queue',
    }),
  ],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    LlmNarrativeService,
    LlmNarrativeProcessor,
    ChessReplayService,
    MoveClassifierService,
    { provide: RAW_ENGINE_ANALYSIS_PROVIDER, useClass: ChessApiEngineProvider },
    { provide: ENGINE_ANALYSIS_PROVIDER, useClass: CachedEngineAnalysisProvider },
  ],
  exports: [AnalysisService, LlmNarrativeService],
})
export class AnalysisModule {}
