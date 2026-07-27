import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class LlmNarrativeService {
  private readonly logger = new Logger(LlmNarrativeService.name);

  constructor(@InjectQueue('llm-narrative-queue') private llmQueue: Queue) {}

  async generateEpicNarrative(gameId: string, pgn: string, factionName: string, location: string, accuracy: number) {
    this.logger.log(`Enqueuing LLM Narrative job for game ${gameId}`);
    
    await this.llmQueue.add('generate', {
      gameId,
      pgn,
      factionName,
      location,
      accuracy
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000 // 5s, 25s, 125s backoff
      },
      removeOnComplete: true,
      removeOnFail: 100 // keep last 100 failed jobs for inspection
    });
  }
}
