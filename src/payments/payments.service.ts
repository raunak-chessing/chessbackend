import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: Stripe;
  private redisClient: ReturnType<RedisService['getClient']>;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private redisService: RedisService,
  ) {
    this.redisClient = this.redisService.getClient();

    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (this.configService.get<string>('NODE_ENV') === 'production' && (!secretKey || !webhookSecret)) {
      throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set in production');
    }

    this.stripe = new Stripe(secretKey || 'sk_test_dummy', {
      apiVersion: '2023-10-16' as any, // Using latest or fallback
    });
  }

  async createCheckoutSession(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new InternalServerErrorException('User not found');
    }

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        metadata: { userId },
      });
      customerId = customer.id;
      
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const priceId = this.configService.get<string>('STRIPE_PREMIUM_PRICE_ID') || 'price_dummy';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${frontendUrl}/billing?success=true`,
      cancel_url: `${frontendUrl}/billing?canceled=true`,
      metadata: {
        userId,
      },
    });

    return { url: session.url };
  }

  async handleWebhookEvent(payload: Buffer, signature: string) {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || 'whsec_dummy';
    
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      throw new InternalServerErrorException(`Webhook Error: ${err.message}`);
    }

    const alreadyProcessed = await this.redisClient.set(
      `stripe_event:${event.id}`,
      '1',
      'EX',
      86400,
      'NX',
    );
    if (!alreadyProcessed) {
      this.logger.log(`Skipping already-processed Stripe event ${event.id}`);
      return { received: true };
    }

    switch (event.type) {
      case 'checkout.session.completed':
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

      case 'customer.subscription.deleted':
        const subscription = event.data.object as Stripe.Subscription;
        await this.prisma.user.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: { isPremium: false },
        });
        break;

      default:
        this.logger.log(`Unhandled event type ${event.type}`);
    }

    return { received: true };
  }
}
