import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GamesModule } from './games/games.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AcademyModule } from './academy/academy.module';
import { MailModule } from './mail/mail.module';
import { PrismaService } from './prisma/prisma.service';
import { MailService } from './mail/mail.service';
import { getAuth } from './auth';
import { DailyGamesModule } from './daily-games/daily-games.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { AnalysisModule } from './analysis/analysis.module';
import { SocialModule } from './social/social.module';
import { PuzzlesModule } from './puzzles/puzzles.module';
import { StudiesModule } from './studies/studies.module';
import { QuestsModule } from './quests/quests.module';
import { FactionsModule } from './factions/factions.module';
import { AntiCheatModule } from './anti-cheat/anti-cheat.module';
import { StreamerModule } from './streamer/streamer.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ObservabilityModule } from './observability/observability.module';
import { PaymentsModule } from './payments/payments.module';
import { OverworldModule } from './overworld/overworld.module';
import { OpeningsModule } from './openings/openings.module';
import { VoteChessModule } from './vote-chess/vote-chess.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          db: config.get<number>('QUEUE_REDIS_DB', 1),
        },
      }),
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    MailModule,
    AuthModule.forRootAsync({
      imports: [PrismaModule, MailModule, ConfigModule],
      inject: [PrismaService, MailService, ConfigService],
      useFactory: (
        prisma: PrismaService,
        mailService: MailService,
        config: ConfigService,
      ) => ({
        auth: getAuth(prisma, mailService, config),
      }),
    }),
    GamesModule,
    PrismaModule,
    UsersModule,
    AcademyModule,
    DailyGamesModule,
    ScheduleModule.forRoot(),
    TournamentsModule,
    AnalysisModule,
    SocialModule,
    PuzzlesModule,
    StudiesModule,
    QuestsModule,
    FactionsModule,
    AntiCheatModule,
    StreamerModule,
    ObservabilityModule,
    PaymentsModule,
    OverworldModule,
    OpeningsModule,
    VoteChessModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    }
  ],
})
export class AppModule {}
