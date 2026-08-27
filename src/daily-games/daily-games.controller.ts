import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { DailyGamesService } from './daily-games.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateDailyGameDto, MakeDailyMoveDto } from './dto/daily-games.dto';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@Controller('api/games/daily')
export class DailyGamesController {
  constructor(private readonly dailyGamesService: DailyGamesService) {}

  @Post()
  async createGame(
    @CurrentUser() userId: string,
    @Body() body: CreateDailyGameDto,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.dailyGamesService.createDailyGame(
      userId,
      body.opponentId,
      body.daysPerMove,
    );
  }

  @Get('my-games')
  async getMyGames(@CurrentUser() userId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.dailyGamesService.getMyDailyGames(userId);
  }

  @AllowAnonymous()
  @Get(':id')
  async getGame(@Param('id') gameId: string) {
    return this.dailyGamesService.getGameById(gameId);
  }

  @Post(':id/move')
  async makeMove(
    @CurrentUser() userId: string,
    @Param('id') gameId: string,
    @Body() body: MakeDailyMoveDto,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.dailyGamesService.makeMove(userId, gameId, body.from, body.to);
  }
}
