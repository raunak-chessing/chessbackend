import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UnauthorizedException,
  Delete,
} from '@nestjs/common';
import { SocialService } from './social.service';
import { SendChallengeDto, ReportUserDto } from './dto/social.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}



  @Get('friends')
  async getFriends(@CurrentUser() userId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.getFriends(userId);
  }

  @Get('requests')
  async getPendingRequests(@CurrentUser() userId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.getPendingRequests(userId);
  }

  @Post('friends/request/:id')
  async sendFriendRequest(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.sendFriendRequest(userId, id);
  }

  @Post('friends/accept/:id')
  async acceptFriendRequest(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.acceptFriendRequest(userId, id);
  }

  @Delete('friends/request/:id')
  async declineFriendRequest(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.declineFriendRequest(userId, id);
  }

  @Get('challenges')
  async getIncomingChallenges(@CurrentUser() userId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.getIncomingChallenges(userId);
  }

  @Post('challenge/:id')
  async sendChallenge(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: SendChallengeDto,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.sendChallenge(
      userId,
      id,
      body.timeControl || '10|0',
      body.colorPref || 'random',
    );
  }

  @Post('challenge/:id/accept')
  async acceptChallenge(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.acceptChallenge(userId, id);
  }

  @Delete('challenge/:id')
  async declineChallenge(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.declineChallenge(userId, id);
  }

  @Post('block/:id')
  async blockUser(@CurrentUser() userId: string, @Param('id') id: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.blockUser(userId, id);
  }

  @Delete('block/:id')
  async unblockUser(@CurrentUser() userId: string, @Param('id') id: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.unblockUser(userId, id);
  }

  @Post('report/:id')
  async reportUser(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: ReportUserDto,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.socialService.reportUser(userId, id, body.reason, body.description);
  }
}
