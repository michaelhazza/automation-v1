/**
 * crm.send_email — payload validation + provider-call builder with merge-field
 * resolution. Distinct from the existing unprefixed `send_email` (which targets
 * a generic email provider); `crm.` prefix routes through the client's CRM.
 */

import { z } from 'zod';
import {
  resolveMergeFieldsOnObject,
  type MergeFieldInputs,
} from '../services/mergeFieldResolverPure.js';

export const crmSendEmailPayloadSchema = z.object({
  from: z.string().min(1),
  toContactId: z.string().min(1),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  provider: z.string().optional(),
  scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).default('immediate'),
  scheduledFor: z.string().datetime().optional(),
});

export type CrmSendEmailPayload = z.infer<typeof crmSendEmailPayloadSchema>;

export interface ProviderCall {
  method: 'POST';
  path: string;
  body: Record<string, unknown>;
  unresolvedMergeFields: string[];
}

export function validateSendEmailPayload(raw: unknown):
  | { ok: true; payload: CrmSendEmailPayload }
  | { ok: false; errorCode: string; message: string } {
  const parsed = crmSendEmailPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errorCode: 'INVALID_PAYLOAD', message: parsed.error.message };
  }
  return { ok: true, payload: parsed.data };
}

export function sendEmailIdempotencyKey(p: {
  subaccountId: string;
  toContactId: string;
  subject: string;
  scheduleHint: string;
  scheduledFor?: string;
}): string {
  const parts = [
    'crm.send_email',
    p.subaccountId,
    p.toContactId,
    hashString(p.subject),
    p.scheduleHint,
  ];
  if (p.scheduledFor) parts.push(p.scheduledFor);
  return parts.join(':');
}

/**
 * Build the provider call. Resolves merge fields in subject + body against
 * the supplied inputs. Unresolved tokens remain as literals AND surface in
 * `unresolvedMergeFields` for the caller to decide how to handle (V1: let the
 * provider see literal `{{contact.firstName}}` so the operator sees exactly
 * what went out rather than a silent empty-string).
 */
export function buildSendEmailProviderCall(
  payload: CrmSendEmailPayload,
  mergeInputs: MergeFieldInputs,
): ProviderCall {
  const { output, unresolved } = resolveMergeFieldsOnObject(
    { subject: payload.subject, body: payload.body },
    mergeInputs,
  );
  return {
    method: 'POST',
    path: `/v1/conversations/email`,
    body: {
      from: payload.from,
      toContactId: payload.toContactId,
      subject: output.subject,
      body: output.body,
      schedule: payload.scheduleHint,
      scheduledFor: payload.scheduledFor,
    },
    unresolvedMergeFields: unresolved,
  };
}

function hashString(s: string): string {
  // Simple DJB2 — deterministic, fast, good enough for idempotency-key
  // composition. Not cryptographic.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
