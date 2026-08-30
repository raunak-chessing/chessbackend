import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { StripePaymentProvider } from './stripe-payment-provider';

describe('StripePaymentProvider', () => {
  let provider: StripePaymentProvider;
  let configValues: Record<string, string>;

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripePaymentProvider,
        { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
      ],
    }).compile();
    return module.get<StripePaymentProvider>(StripePaymentProvider);
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('warns when Stripe keys are not configured, but still constructs (dummy fallback)', async () => {
    configValues = {};
    provider = await build();
    expect(Logger.prototype.warn).toHaveBeenCalled();
    expect(provider).toBeDefined();
  });

  it('does not warn when both keys are configured', async () => {
    configValues = { STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' };
    provider = await build();
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  describe('with a configured provider', () => {
    beforeEach(async () => {
      configValues = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' };
      provider = await build();
    });

    it('createCustomer delegates to the Stripe SDK and returns the id', async () => {
      const stripe = (provider as any).stripe;
      jest.spyOn(stripe.customers, 'create').mockResolvedValueOnce({ id: 'cus_1' });

      const result = await provider.createCustomer('a@b.com', { userId: 'u1' });

      expect(stripe.customers.create).toHaveBeenCalledWith({
        email: 'a@b.com',
        metadata: { userId: 'u1' },
      });
      expect(result).toEqual({ id: 'cus_1' });
    });

    it('createCheckoutSession delegates to the Stripe SDK with the right shape', async () => {
      const stripe = (provider as any).stripe;
      jest.spyOn(stripe.checkout.sessions, 'create').mockResolvedValueOnce({ url: 'https://checkout' });

      const result = await provider.createCheckoutSession({
        customerId: 'cus_1',
        priceId: 'price_1',
        successUrl: 'https://app/success',
        cancelUrl: 'https://app/cancel',
        metadata: { userId: 'u1' },
      });

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_1',
          mode: 'subscription',
          success_url: 'https://app/success',
          cancel_url: 'https://app/cancel',
          metadata: { userId: 'u1' },
        }),
      );
      expect(result).toEqual({ url: 'https://checkout' });
    });

    it('constructWebhookEvent delegates to the Stripe SDK with the configured secret', () => {
      const stripe = (provider as any).stripe;
      const fakeEvent = { id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } };
      jest.spyOn(stripe.webhooks, 'constructEvent').mockReturnValueOnce(fakeEvent);

      const payload = Buffer.from('{}');
      const result = provider.constructWebhookEvent(payload, 'sig_1');

      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(payload, 'sig_1', 'whsec_x');
      expect(result).toBe(fakeEvent);
    });

    it('constructWebhookEvent propagates a signature-verification failure', () => {
      const stripe = (provider as any).stripe;
      jest.spyOn(stripe.webhooks, 'constructEvent').mockImplementationOnce(() => {
        throw new Error('invalid signature');
      });

      expect(() => provider.constructWebhookEvent(Buffer.from('{}'), 'bad-sig')).toThrow(
        'invalid signature',
      );
    });
  });
});
