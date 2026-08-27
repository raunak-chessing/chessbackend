import { Controller, Get, Post, Body, Req, UnauthorizedException } from '@nestjs/common';
import { FactionsService } from './factions.service';
import type { AuthenticatedRequest } from '../types';

@Controller('api/factions')
export class FactionsController {
  constructor(private readonly factionsService: FactionsService) {}

  @Get()
  async getFactions() {
    return this.factionsService.getAllFactions();
  }

  @Post('join')
  async joinFaction(@Req() req: AuthenticatedRequest, @Body('factionId') factionId: string) {
    if (!req.user || !req.user.id) throw new UnauthorizedException();
    return this.factionsService.joinFaction(req.user.id, factionId);
  }

  @Get('divisions')
  async getDivisions() {
    return this.factionsService.getCurrentDivisions();
  }
}
