import { Controller, Post, Req, Res, Headers, UnauthorizedException, HttpCode, HttpStatus } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout')
  async createCheckoutSession(@CurrentUser() userId: string) {
    if (!userId) throw new UnauthorizedException('Not logged in');
    return this.paymentsService.createCheckoutSession(userId);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!req.rawBody) {
      throw new UnauthorizedException('Missing raw request body for webhook signature verification');
    }
    return this.paymentsService.handleWebhookEvent(req.rawBody, signature);
  }
}
