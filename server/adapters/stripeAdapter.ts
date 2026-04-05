import axios from 'axios';
import { connectionTokenService } from '../services/connectionTokenService.js';
import type { IntegrationAdapter, PaymentsCreateCheckoutInput } from './integrationAdapter.js';
import { classifyAdapterError } from './integrationAdapter.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 12_000;

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
