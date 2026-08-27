import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
import { InventoryModule } from './inventory/inventory.module';
import { ShopModule } from './shop/shop.module';
import { AdminModule } from './admin/admin.module';
import { envValidationSchema } from './config/env.validation';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
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
      imports: [PrismaModule, MailModule, ConfigModule, RedisModule],
      inject: [PrismaService, MailService, ConfigService, RedisService],
      useFactory: (
        prisma: PrismaService,
        mailService: MailService,
        config: ConfigService,
        redisService: RedisService,
      ) => ({
        auth: getAuth(prisma, mailService, config, redisService),
      }),
    }),
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
    InventoryModule,
    ShopModule,
    AdminModule,
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
