import { Controller, Get, Post, Body, UnauthorizedException } from '@nestjs/common';
import { VoteChessService } from './vote-chess.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString, IsNotEmpty } from 'class-validator';

class SubmitVoteDto {
  @IsString()
  @IsNotEmpty()
  sanMove: string;
}

@Controller('api/vote-chess')
export class VoteChessController {
  constructor(private readonly voteChessService: VoteChessService) {}

  @Get('state')
  async getState() {
    let state = await this.voteChessService.getActiveBossFight();
    if (!state) {
      state = await this.voteChessService.initializeDefaultState();
    }
    return { status: 'ok', state };
  }

  @Post('vote')
  async submitVote(
    @CurrentUser() userId: string,
    @Body() body: SubmitVoteDto,
  ) {
    if (!userId) throw new UnauthorizedException('Must be logged in to vote');
    return this.voteChessService.submitVote(userId, body.sanMove);
  }
}
