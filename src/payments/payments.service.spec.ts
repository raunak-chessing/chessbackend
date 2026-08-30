import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { CacheService } from '../redis/cache.service';
import { PAYMENT_PROVIDER, IPaymentProvider } from './payment-provider.interface';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let cacheService: jest.Mocked<Pick<CacheService, 'setIfNotExists'>>;
  let paymentProvider: jest.Mocked<IPaymentProvider>;
  let configValues: Record<string, string>;

  beforeEach(async () => {
    jest.clearAllMocks();

    cacheService = { setIfNotExists: jest.fn().mockResolvedValue(true) };
    paymentProvider = {
      createCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
      constructWebhookEvent: jest.fn(),
    };
    configValues = {
      STRIPE_PREMIUM_PRICE_ID: 'price_123',
      FRONTEND_URL: 'http://localhost:3000',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        getPrismaMockProvider(),
        { provide: CacheService, useValue: cacheService },
        { provide: PAYMENT_PROVIDER, useValue: paymentProvider },
        { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('createCheckoutSession', () => {
    it('throws when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.createCheckoutSession('u1')).rejects.toThrow(InternalServerErrorException);
    });

    it('reuses an existing Stripe customer without creating a new one', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        email: 'a@b.com',
        stripeCustomerId: 'cus_existing',
      } as any);
      paymentProvider.createCheckoutSession.mockResolvedValueOnce({ url: 'https://checkout' });

      const res = await service.createCheckoutSession('u1');

      expect(paymentProvider.createCustomer).not.toHaveBeenCalled();
      expect(paymentProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_existing', priceId: 'price_123' }),
      );
      expect(res).toEqual({ url: 'https://checkout' });
    });

    it('creates and persists a new Stripe customer when the user has none', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        email: 'a@b.com',
        stripeCustomerId: null,
      } as any);
      paymentProvider.createCustomer.mockResolvedValueOnce({ id: 'cus_new' });
      paymentProvider.createCheckoutSession.mockResolvedValueOnce({ url: 'https://checkout' });

      await service.createCheckoutSession('u1');

      expect(paymentProvider.createCustomer).toHaveBeenCalledWith('a@b.com', { userId: 'u1' });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { stripeCustomerId: 'cus_new' },
      });
      expect(paymentProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_new' }),
      );
    });
  });

  describe('handleWebhookEvent', () => {
    it('rejects an invalid signature', async () => {
      paymentProvider.constructWebhookEvent.mockImplementationOnce(() => {
        throw new Error('bad signature');
      });
      await expect(service.handleWebhookEvent(Buffer.from(''), 'sig')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('skips an event already processed (idempotency)', async () => {
      paymentProvider.constructWebhookEvent.mockReturnValueOnce({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { object: {} },
      });
      cacheService.setIfNotExists.mockResolvedValueOnce(false);

      const res = await service.handleWebhookEvent(Buffer.from(''), 'sig');

      expect(res).toEqual({ received: true });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('marks the user premium on checkout.session.completed', async () => {
      paymentProvider.constructWebhookEvent.mockReturnValueOnce({
        id: 'evt_2',
        type: 'checkout.session.completed',
        data: {
          object: {
            subscription: 'sub_1',
            customer: 'cus_1',
            metadata: { userId: 'u1' },
          },
        },
      });

      await service.handleWebhookEvent(Buffer.from(''), 'sig');

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { isPremium: true, stripeSubscriptionId: 'sub_1' },
      });
    });

    it('revokes premium on customer.subscription.deleted', async () => {
      paymentProvider.constructWebhookEvent.mockReturnValueOnce({
        id: 'evt_3',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1' } },
      });

      await service.handleWebhookEvent(Buffer.from(''), 'sig');

      expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_1' },
        data: { isPremium: false },
      });
    });

    it('ignores unhandled event types', async () => {
      paymentProvider.constructWebhookEvent.mockReturnValueOnce({
        id: 'evt_4',
        type: 'invoice.paid',
        data: { object: {} },
      });

      const res = await service.handleWebhookEvent(Buffer.from(''), 'sig');
      expect(res).toEqual({ received: true });
    });
  });
});
