import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { StripePaymentProvider } from './stripe-payment-provider';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: PAYMENT_PROVIDER, useClass: StripePaymentProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
