import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface LLMNarrativeJob {
  gameId: string;
  pgn: string;
  factionName: string;
  location: string;
  accuracy: number;
}

@Processor('llm-narrative-queue', {
  concurrency: 5, // Process up to 5 generations concurrently
  limiter: {
    max: 10, // Max 10 jobs per second to avoid Gemini API rate limits
    duration: 1000,
  }
})
export class LlmNarrativeProcessor extends WorkerHost {
  private readonly logger = new Logger(LlmNarrativeProcessor.name);
  
  // Very basic circuit breaker state
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService
  ) {
    super();
  }

  async process(job: Job<LLMNarrativeJob>) {
    const { gameId, pgn, factionName, location, accuracy } = job.data;
    
    // Circuit Breaker Check
    if (this.failureCount >= 5 && Date.now() - this.lastFailureTime < 60000) {
      this.logger.warn(`Circuit Breaker OPEN. Falling back to static narrative for game ${gameId}`);
      await this.saveFallback(gameId, factionName, location, accuracy);
      return;
    }

    try {
      this.logger.log(`Processing LLM generation for game ${gameId}...`);
      
      const apiKey = this.configService.get<string>('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error('No API Key');
      }

      const prompt = `You are "The Seer", an ancient mystic in Aethelgard. 
You are recounting the tale of a chess battle.
Faction: ${factionName}
Location: ${location}
Accuracy: ${accuracy}%
PGN:
${pgn}
Write a 3-paragraph epic fantasy narrative describing this battle.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
        })
      });

      if (!response.ok) {
        throw new Error(`LLM API Error: ${response.statusText}`);
      }

      const data = await response.json();
      let narrative = '';
      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        narrative = data.candidates[0].content.parts[0].text;
      } else {
        throw new Error('Invalid LLM response structure');
      }

      // Save to DB
      await this.saveNarrative(gameId, narrative);
      
      // Reset circuit breaker on success
      this.failureCount = 0;
      
    } catch (e) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      const errMessage = e instanceof Error ? e.message : 'Unknown error';
      this.logger.error(`LLM Generation Failed (Attempt ${job.attemptsMade + 1}): ${errMessage}`);
      
      // The BullMQ backoff strategy will retry this job.
      // If it exhausts retries, it moves to the Dead Letter Queue (DLQ).
      throw e; 
    }
  }

  private async saveNarrative(gameId: string, narrative: string) {
    await this.prisma.game.update({
      where: { id: gameId },
      data: { 
        analysis: { narrative }
      }
    }).catch(e => this.logger.error(`Failed to save narrative to game ${gameId}`, e));
  }

  private async saveFallback(gameId: string, factionName: string, location: string, accuracy: number) {
    const text = `In the shadow of ${location}, the forces of the ${factionName} clashed in a brutal struggle. Your strategic prowess measured an accuracy of ${accuracy}%.`;
    await this.saveNarrative(gameId, text);
  }
}
