/**
 * crm.send_sms — payload validation + provider-call builder with merge-field
 * resolution. Same shape as crm.send_email but via CRM SMS channel.
 */

import { z } from 'zod';
import {
  resolveMergeFields,
  type MergeFieldInputs,
} from '../services/mergeFieldResolverPure.js';

export const crmSendSmsPayloadSchema = z.object({
  fromNumber: z.string().min(1),
  toContactId: z.string().min(1),
  body: z.string().min(1).max(1_600), // practical upper bound (10 segments)
  provider: z.string().optional(),
  scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).default('immediate'),
  scheduledFor: z.string().datetime().optional(),
});

export type CrmSendSmsPayload = z.infer<typeof crmSendSmsPayloadSchema>;

export interface ProviderCall {
  method: 'POST';
  path: string;
  body: Record<string, unknown>;
  unresolvedMergeFields: string[];
  segmentCount: number;
}

export function validateSendSmsPayload(raw: unknown):
  | { ok: true; payload: CrmSendSmsPayload }
  | { ok: false; errorCode: string; message: string } {
  const parsed = crmSendSmsPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errorCode: 'INVALID_PAYLOAD', message: parsed.error.message };
  }
  return { ok: true, payload: parsed.data };
}

export function sendSmsIdempotencyKey(p: {
  subaccountId: string;
  toContactId: string;
  body: string;
  scheduleHint: string;
  scheduledFor?: string;
}): string {
  const parts = [
    'crm.send_sms',
    p.subaccountId,
    p.toContactId,
    hashString(p.body),
    p.scheduleHint,
  ];
  if (p.scheduledFor) parts.push(p.scheduledFor);
  return parts.join(':');
}

export function countSmsSegments(body: string): number {
  // GSM-7: 160 chars/segment. Unicode: 70 chars/segment. V1 assumes GSM-7.
  // Multi-segment messages get a UDH header that shortens each segment to
  // 153 chars (GSM-7).
  if (body.length <= 160) return 1;
  return Math.ceil(body.length / 153);
}

export function buildSendSmsProviderCall(
  payload: CrmSendSmsPayload,
  mergeInputs: MergeFieldInputs,
): ProviderCall {
  const { output, unresolved } = resolveMergeFields(payload.body, mergeInputs);
  return {
    method: 'POST',
    path: `/v1/conversations/sms`,
    body: {
      fromNumber: payload.fromNumber,
      toContactId: payload.toContactId,
      body: output,
      schedule: payload.scheduleHint,
      scheduledFor: payload.scheduledFor,
    },
    unresolvedMergeFields: unresolved,
    segmentCount: countSmsSegments(output),
  };
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
