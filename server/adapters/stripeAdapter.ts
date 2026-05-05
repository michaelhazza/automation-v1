import axios from 'axios';
import { connectionTokenService } from '../services/connectionTokenService.js';
import type { IntegrationAdapter, PaymentsCreateCheckoutInput } from './integrationAdapter.js';
import { classifyAdapterError } from './integrationAdapter.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// chargeViaSpt — agent-spend Stripe charge using SPT (Shared Payment Token)
//
// Called exclusively by chargeRouterService.executeApproved on the
// main_app_stripe path. Stripe errors propagate as-is so classifyStripeError
// in chargeRouterServicePure can classify them. Invariant 34: metadata must
// carry agent_charge_id + mode + traceId.
// ---------------------------------------------------------------------------

export interface ChargeViaSptInput {
  sptToken: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  merchantId: string | null;
  merchantDescriptor: string;
  metadata: { agent_charge_id: string; mode: 'live'; traceId: string };
}

export interface ChargeViaSptResult {
  providerChargeId: string;
}

/**
 * Create a Stripe PaymentIntent using the Shared Payment Token.
 * Throws on any Stripe error — caller handles via classifyStripeError.
 */
export async function chargeViaSpt(input: ChargeViaSptInput): Promise<ChargeViaSptResult> {
  const params = new URLSearchParams();
  params.append('amount', String(input.amountMinor));
  params.append('currency', input.currency.toLowerCase());
  params.append('confirm', 'true');
  if (input.merchantId) {
    params.append('payment_method', input.merchantId);
  }
  params.append('metadata[agent_charge_id]', input.metadata.agent_charge_id);
  params.append('metadata[mode]', input.metadata.mode);
  params.append('metadata[traceId]', input.metadata.traceId);

  const response = await axios.post(
    `${STRIPE_API_BASE}/payment_intents`,
    params.toString(),
    {
      headers: {
        Authorization: `Bearer ${input.sptToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': input.idempotencyKey,
      },
      timeout: TIMEOUT_MS,
    },
  );

  const data = response.data as { id?: string };
  if (!data.id) {
    throw Object.assign(new Error('Stripe PaymentIntent missing id'), { statusCode: 500 });
  }

  return { providerChargeId: data.id };
}

/**
 * Get the active SPT (Shared Payment Token) for a stripe_agent connection.
 * Reads accessToken via connectionTokenService.getAccessToken, which triggers
 * auto-refresh if the token is within the per-provider refresh buffer window.
 *
 * Used exclusively by the agent-spend execution path (chargeRouterService).
 * The existing checkout path continues to read secretsRef directly — do NOT
 * use this function for the checkout/payment-status path.
 */
export async function getAgentSpendToken(connection: IntegrationConnection): Promise<string> {
  return connectionTokenService.getAccessToken(connection);
}

export const stripeAdapter: IntegrationAdapter = {
  supportedActions: ['create_checkout', 'get_payment_status'],

  payments: {
    async createCheckout(connection: IntegrationConnection, fields: PaymentsCreateCheckoutInput) {
      try {
        if (!connection.secretsRef) {
          return { checkoutUrl: '', sessionId: '', success: false, error: { code: 'auth_error' as const, retryable: false, message: 'Connection has no secret key configured' } };
        }

        const secretKey = connectionTokenService.decryptToken(connection.secretsRef);

        const { amount, successUrl, cancelUrl } = fields;
        const currency = fields.currency || 'usd';
        const productName = fields.productName || 'Purchase';

        if (!amount || !successUrl || !cancelUrl) {
          return {
            checkoutUrl: '',
            sessionId: '',
            success: false,
            error: { code: 'validation_error' as const, retryable: false, message: 'Missing required fields: amount, successUrl, cancelUrl' },
          };
        }

        const params = new URLSearchParams();
        params.append('mode', 'payment');
        params.append('line_items[0][price_data][currency]', currency);
        params.append('line_items[0][price_data][unit_amount]', String(amount));
        params.append('line_items[0][price_data][product_data][name]', productName);
        params.append('line_items[0][quantity]', '1');
        params.append('success_url', successUrl);
        params.append('cancel_url', cancelUrl);

        const response = await axios.post(`${STRIPE_API_BASE}/checkout/sessions`, params.toString(), {
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: TIMEOUT_MS,
        });

        const data = response.data as { url?: string; id?: string };
        return {
          checkoutUrl: data.url ?? '',
          sessionId: data.id ?? '',
          success: true,
        };
      } catch (err) {
        return { checkoutUrl: '', sessionId: '', success: false, error: classifyAdapterError(err, 'stripe', 'createCheckout') };
      }
    },

    async getPaymentStatus(connection: IntegrationConnection, sessionId: string) {
      try {
        if (!connection.secretsRef) {
          return { status: 'failed' as const, success: false, error: { code: 'auth_error' as const, retryable: false, message: 'Connection has no secret key configured' } };
        }

        const secretKey = connectionTokenService.decryptToken(connection.secretsRef);

        const response = await axios.get(`${STRIPE_API_BASE}/checkout/sessions/${sessionId}`, {
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
          timeout: TIMEOUT_MS,
        });

        const data = response.data as { payment_status?: string };
        const paymentStatus = data.payment_status;

        let status: 'pending' | 'completed' | 'failed' | 'expired';
        switch (paymentStatus) {
          case 'paid':
            status = 'completed';
            break;
          case 'unpaid':
            status = 'pending';
            break;
          default:
            status = 'failed';
        }

        return { status, success: true };
      } catch (err) {
        return { status: 'failed' as const, success: false, error: classifyAdapterError(err, 'stripe', 'getPaymentStatus') };
      }
    },
  },
};
