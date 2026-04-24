/**
 * notify_operator — internal operator-facing alert (renamed from
 * clientpulse.operator_alert in Session 1 per contract (i) — platform
 * primitives are module-agnostic).
 *
 * Unlike the 4 CRM primitives, this does not hit an external provider. On
 * approval, the execution path writes a notification row (in-app) and defers
 * email/slack fan-out to the existing notifications worker.
 */

import { z } from 'zod';

export const operatorAlertPayloadSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(5_000),
  severity: z.enum(['info', 'warn', 'urgent']).default('info'),
  recipients: z.object({
    kind: z.enum(['preset', 'custom']),
    value: z.union([z.string(), z.array(z.string())]),
  }),
  channels: z.array(z.enum(['in_app', 'email', 'slack'])).min(1),
});

export type OperatorAlertPayload = z.infer<typeof operatorAlertPayloadSchema>;

export interface AvailableChannels {
  inApp: boolean;
  email: boolean;
  slack: boolean;
}

export function validateOperatorAlertPayload(raw: unknown):
  | { ok: true; payload: OperatorAlertPayload }
  | { ok: false; errorCode: string; message: string } {
  const parsed = operatorAlertPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errorCode: 'INVALID_PAYLOAD', message: parsed.error.message };
  }
  return { ok: true, payload: parsed.data };
}

export function operatorAlertIdempotencyKey(p: {
  subaccountId: string;
  orgId: string;
  title: string;
  severity: string;
}): string {
  return [
    'notify_operator',
    p.subaccountId ?? p.orgId,
    hashString(p.title),
    p.severity,
  ].join(':');
}

/**
 * Filter the operator's requested channels against what the org actually has
 * configured. Returns the subset that will fan out + a list of channels
 * skipped with their reason. Used by the action handler at execution time.
 */
export function filterChannelsAgainstAvailability(
  requested: Array<'in_app' | 'email' | 'slack'>,
  available: AvailableChannels,
): {
  fanOut: Array<'in_app' | 'email' | 'slack'>;
  skipped: Array<{ channel: string; reason: string }>;
} {
  const fanOut: Array<'in_app' | 'email' | 'slack'> = [];
  const skipped: Array<{ channel: string; reason: string }> = [];
  for (const channel of requested) {
    if (channel === 'in_app' && available.inApp) fanOut.push(channel);
    else if (channel === 'email' && available.email) fanOut.push(channel);
    else if (channel === 'slack' && available.slack) fanOut.push(channel);
    else skipped.push({ channel, reason: `${channel} not configured for org` });
  }
  return { fanOut, skipped };
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
