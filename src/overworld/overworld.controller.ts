import { Controller, Get, Post, Body, UnauthorizedException } from '@nestjs/common';
import { OverworldService } from './overworld.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/overworld')
export class OverworldController {
  constructor(private readonly overworldService: OverworldService) {}

  @Get('map')
  async getMapState(@CurrentUser() userId?: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.overworldService.getMapState(userId);
  }

  @Post('build')
  async buildStructure(
    @Body() dto: { hexId: string; type: string },
    @CurrentUser() userId?: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.overworldService.buildStructure(userId, dto.hexId, dto.type);
  }

  @Post('siege')
  async siegeHex(
    @Body() dto: { hexId: string },
    @CurrentUser() userId?: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    // We need to resolve the user's factionId first.
    // The overworldService.applySiegeDamage expects an attackerFactionId.
    // We can fetch user from DB or inject a users service. Wait, best to let the service handle it or fetch it here.
    return this.overworldService.siegeHex(userId, dto.hexId);
  }
}
