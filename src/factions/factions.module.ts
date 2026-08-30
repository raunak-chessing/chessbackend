import { Global, Module } from '@nestjs/common';
import { FactionsService } from './factions.service';
import { FactionsController } from './factions.controller';
import { EraLifecycleService } from './era-lifecycle.service';
import { DivisionPromotionService } from './division-promotion.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [FactionsController],
  providers: [FactionsService, EraLifecycleService, DivisionPromotionService],
  exports: [FactionsService],
})
export class FactionsModule {}
