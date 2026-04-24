/**
 * crm.fire_automation — payload validation + provider-call builder.
 *
 * V1 pilot: the action is proposed via the review queue. On approval, the
 * execution layer's API adapter would dispatch here to shape the provider
 * call. Until the adapter wiring lands, this service is exercised only via
 * unit tests — the action row shape is what carries the pilot.
 */

import { z } from 'zod';

export const crmFireAutomationPayloadSchema = z.object({
  automationId: z.string().min(1),
  contactId: z.string().min(1),
  scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).default('immediate'),
  scheduledFor: z.string().datetime().optional(),
  provider: z.string().optional(),
});

export type CrmFireAutomationPayload = z.infer<typeof crmFireAutomationPayloadSchema>;

export interface ProviderCall {
  method: 'POST';
  path: string;
  body: Record<string, unknown>;
}

export function validateFireAutomationPayload(raw: unknown):
  | { ok: true; payload: CrmFireAutomationPayload }
  | { ok: false; errorCode: string; message: string } {
  const parsed = crmFireAutomationPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errorCode: 'INVALID_PAYLOAD', message: parsed.error.message };
  }
  if (parsed.data.scheduleHint === 'scheduled' && !parsed.data.scheduledFor) {
    return { ok: false, errorCode: 'MISSING_SCHEDULE', message: 'scheduledFor required when scheduleHint=scheduled' };
  }
  return { ok: true, payload: parsed.data };
}

/**
 * Build the idempotency key for this intervention. Dedup vector includes
 * scheduleHint so "fire now" and "fire tomorrow" are distinct actions.
 */
export function fireAutomationIdempotencyKey(p: {
  subaccountId: string;
  automationId: string;
  contactId: string;
  scheduleHint: string;
  scheduledFor?: string;
}): string {
  const parts = [
    'crm.fire_automation',
    p.subaccountId,
    p.automationId,
    p.contactId,
    p.scheduleHint,
  ];
  if (p.scheduledFor) parts.push(p.scheduledFor);
  return parts.join(':');
}

export function buildFireAutomationProviderCall(payload: CrmFireAutomationPayload): ProviderCall {
  return {
    method: 'POST',
    path: `/v1/automations/${payload.automationId}/fire`,
    body: {
      contactId: payload.contactId,
      schedule: payload.scheduleHint,
      scheduledFor: payload.scheduledFor,
    },
  };
}
