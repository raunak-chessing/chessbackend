export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentCustomer {
  id: string;
}

export interface CreateCheckoutSessionParams {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface CheckoutSession {
  url: string | null;
}

export interface PaymentWebhookEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

/**
 * Everything PaymentsService needs from a payment processor. PaymentsService
 * depends on this interface, not on Stripe's SDK — swapping processors (or
 * unit-testing PaymentsService with a fake) means providing a different
 * implementation, not editing the service.
 */
export interface IPaymentProvider {
  createCustomer(email: string, metadata: Record<string, string>): Promise<PaymentCustomer>;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession>;
  /** Verifies the webhook signature and parses the event. Throws on an invalid signature. */
  constructWebhookEvent(payload: Buffer, signature: string): PaymentWebhookEvent;
}
