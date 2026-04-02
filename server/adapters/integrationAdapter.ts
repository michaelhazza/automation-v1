import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

export interface CrmCreateContactResult {
  contactId: string;
  success: boolean;
  error?: string;
}

export interface PaymentsCreateCheckoutResult {
  checkoutUrl: string;
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface PaymentsGetStatusResult {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  success: boolean;
  error?: string;
}

export interface IntegrationAdapter {
  supportedActions: string[];
  crm?: {
    createContact(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<CrmCreateContactResult>;
  };
  payments?: {
    createCheckout(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<PaymentsCreateCheckoutResult>;
    getPaymentStatus(connection: IntegrationConnection, sessionId: string): Promise<PaymentsGetStatusResult>;
  };
}
