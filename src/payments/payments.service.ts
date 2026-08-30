import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import type { IPaymentProvider, PaymentWebhookEvent } from './payment-provider.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private cacheService: CacheService,
    @Inject(PAYMENT_PROVIDER) private paymentProvider: IPaymentProvider,
  ) {}

  async createCheckoutSession(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new InternalServerErrorException('User not found');
    }

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await this.paymentProvider.createCustomer(user.email, { userId });
      customerId = customer.id;

      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const priceId = this.configService.get<string>('STRIPE_PREMIUM_PRICE_ID') || 'price_dummy';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    const session = await this.paymentProvider.createCheckoutSession({
      customerId,
      priceId,
      successUrl: `${frontendUrl}/billing?success=true`,
      cancelUrl: `${frontendUrl}/billing?canceled=true`,
      metadata: { userId },
    });

    return { url: session.url };
  }

  async handleWebhookEvent(payload: Buffer, signature: string) {
    let event: PaymentWebhookEvent;

    try {
      event = this.paymentProvider.constructWebhookEvent(payload, signature);
    } catch (err: any) {
      throw new InternalServerErrorException(`Webhook Error: ${err.message}`);
    }

    const isNewEvent = await this.cacheService.setIfNotExists(`stripe_event:${event.id}`, '1', 86400);
    if (!isNewEvent) {
      this.logger.log(`Skipping already-processed Stripe event ${event.id}`);
      return { received: true };
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription && session.customer) {
          const userId = session.metadata?.userId;
          if (userId) {
            await this.prisma.user.update({
              where: { id: userId },
              data: {
                isPremium: true,
                stripeSubscriptionId: session.subscription as string,
              },
            });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: { isPremium: false },
        });
        break;
      }

      default:
        this.logger.log(`Unhandled event type ${event.type}`);
    }

    return { received: true };
  }
}
