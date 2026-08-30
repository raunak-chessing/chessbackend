import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  CheckoutSession,
  CreateCheckoutSessionParams,
  IPaymentProvider,
  PaymentCustomer,
  PaymentWebhookEvent,
} from './payment-provider.interface';

@Injectable()
export class StripePaymentProvider implements IPaymentProvider {
  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || 'whsec_dummy';

    if (!secretKey || !this.configService.get<string>('STRIPE_WEBHOOK_SECRET')) {
      this.logger.warn(
        'STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set — payments are disabled; checkout and webhook calls will fail until real keys are configured.',
      );
    }

    this.stripe = new Stripe(secretKey || 'sk_test_dummy', {
      apiVersion: '2023-10-16' as any, // Using latest or fallback
    });
  }

  async createCustomer(email: string, metadata: Record<string, string>): Promise<PaymentCustomer> {
    const customer = await this.stripe.customers.create({ email, metadata });
    return { id: customer.id };
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
      customer: params.customerId,
      payment_method_types: ['card'],
      line_items: [{ price: params.priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    });
    return { url: session.url };
  }

  constructWebhookEvent(payload: Buffer, signature: string): PaymentWebhookEvent {
    return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
  }
}
