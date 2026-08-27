import { Controller, Get, Post, Param, UnauthorizedException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  async getMyInventory(@CurrentUser() userId?: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.inventoryService.getInventory(userId);
  }

  @Post('equip/:itemId')
  async equipItem(@CurrentUser() userId: string, @Param('itemId') itemId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.inventoryService.equipItem(userId, itemId);
  }

  @Post('unequip/:itemId')
  async unequipItem(@CurrentUser() userId: string, @Param('itemId') itemId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.inventoryService.unequipItem(userId, itemId);
  }
}
