import { Controller, Get, Post, Param, Body, UnauthorizedException } from '@nestjs/common';
import { WagerService } from './wager.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsNumber, IsString, Min } from 'class-validator';

class PlaceWagerDto {
  @IsString()
  predictedWinnerId: string;

  @IsNumber()
  @Min(1)
  amount: number;
}

@Controller('api/social/wagers')
export class WagerController {
  constructor(private readonly wagerService: WagerService) {}

  @Get(':gameId/odds')
  async getOdds(@Param('gameId') gameId: string) {
    const odds = await this.wagerService.getOdds(gameId);
    return { status: 'ok', gameId, odds };
  }

  @Post(':gameId')
  async placeWager(
    @CurrentUser() userId: string,
    @Param('gameId') gameId: string,
    @Body() body: PlaceWagerDto,
  ) {
    if (!userId) throw new UnauthorizedException('Must be logged in to wager');
    return this.wagerService.placeWager(userId, gameId, body.predictedWinnerId, body.amount);
  }
}
