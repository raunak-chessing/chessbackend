import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { CreateArenaDto, CreateSwissDto } from './dto/tournaments.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../admin/guards/admin.guard';

@Controller('api/tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @AllowAnonymous()
  @Get()
  async getTournaments() {
    return this.tournamentsService.listTournaments();
  }

  @AllowAnonymous()
  @Get(':id')
  async getTournamentDetails(@Param('id') id: string) {
    return this.tournamentsService.getTournament(id);
  }

  @AllowAnonymous()
  @Get(':id/standings')
  async getStandings(@Param('id') id: string) {
    return this.tournamentsService.getStandings(id);
  }

  @AllowAnonymous()
  @Get(':id/pairings/:round')
  async getPairings(@Param('id') id: string, @Param('round') round: string) {
    return this.tournamentsService.getPairingsForRound(id, parseInt(round, 10));
  }

  @Post(':id/join')
  async joinTournament(
    @CurrentUser() userId: string,
    @Param('id') tournamentId: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.tournamentsService.joinTournament(userId, tournamentId);
  }

  @Post('create-arena')
  @UseGuards(AdminGuard)
  async createArena(@Body() body: CreateArenaDto) {
    const startTime = new Date(Date.now() + body.startsInMinutes * 60000);
    return this.tournamentsService.createArena(
      body.name,
      body.timeControl,
      startTime,
      body.durationMinutes,
    );
  }

  @Post('create-swiss')
  @UseGuards(AdminGuard)
  async createSwiss(@Body() body: CreateSwissDto) {
    const startTime = new Date(Date.now() + body.startsInMinutes * 60000);
    return this.tournamentsService.createSwiss(
      body.name,
      body.timeControl,
      body.maxRounds,
      startTime,
    );
  }
}
