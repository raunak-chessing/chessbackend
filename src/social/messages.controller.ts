import { Controller, Get, Post, Param, Body, Query, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/messages.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CacheService } from '../redis/cache.service';

@Controller('api/social/messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  async listConversations(@CurrentUser() userId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.messagesService.listConversations(userId);
  }

  @Get(':userId')
  async getConversation(
    @CurrentUser() userId: string,
    @Param('userId') otherUserId: string,
    @Query('cursor') cursor?: string,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.messagesService.getConversation(userId, otherUserId, cursor);
  }

  @Post(':userId')
  async sendMessage(
    @CurrentUser() userId: string,
    @Param('userId') receiverId: string,
    @Body() body: SendMessageDto,
  ) {
    if (!userId) throw new UnauthorizedException('Not logged in');

    const withinLimit = await this.cacheService.checkRateLimit(`ratelimit:dm:${userId}`, 20, 10);
    if (!withinLimit) throw new BadRequestException('You are sending messages too quickly');

    return this.messagesService.sendMessage(userId, receiverId, body.content);
  }
}
