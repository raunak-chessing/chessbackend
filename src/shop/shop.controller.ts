import { Controller, Get, Post, Param, UnauthorizedException } from '@nestjs/common';
import { ShopService } from './shop.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@Controller('api/shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @AllowAnonymous()
  @Get()
  async listCatalog() {
    return this.shopService.listCatalog();
  }

  @Post('purchase/:shopItemId')
  async purchase(@CurrentUser() userId: string, @Param('shopItemId') shopItemId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.shopService.purchase(userId, shopItemId);
  }
}
