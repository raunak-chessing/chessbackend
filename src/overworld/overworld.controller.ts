import { Controller, Get, Post, Body, UnauthorizedException } from '@nestjs/common';
import { OverworldService } from './overworld.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/overworld')
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
}
