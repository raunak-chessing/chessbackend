import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';
import { FlagUserDto, PauseMatchmakingDto } from './dto/admin.dto';

@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('check')
  check() {
    return { isAdmin: true };
  }

  @Post('flag-user')
  flagUser(@Body() body: FlagUserDto) {
    return this.adminService.flagUser(body.userId, body.reason);
  }

  @Delete('chat/:messageId')
  deleteChatMessage(@Param('messageId') messageId: string) {
    return this.adminService.deleteChatMessage(messageId);
  }

  @Post('matchmaking/pause')
  setMatchmakingPaused(@Body() body: PauseMatchmakingDto) {
    return this.adminService.setMatchmakingPaused(body.paused);
  }
}
