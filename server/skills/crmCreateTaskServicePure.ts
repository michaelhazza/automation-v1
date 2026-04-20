/**
 * crm.create_task — payload validation + provider-call builder.
 *
 * Distinct from the existing unprefixed `create_task` which writes to the
 * internal tasks board. The `crm.` prefix creates a task on the client's CRM
 * (e.g. a GHL task on a contact).
 */

import { z } from 'zod';

export const crmCreateTaskPayloadSchema = z.object({
  assigneeUserId: z.string().min(1),
  relatedContactId: z.string().nullable().optional(),
  title: z.string().min(1).max(500),
  notes: z.string().max(10_000).optional(),
  dueAt: z.string().datetime(),
  priority: z.enum(['low', 'med', 'high']).default('med'),
  provider: z.string().optional(),
});

export type CrmCreateTaskPayload = z.infer<typeof crmCreateTaskPayloadSchema>;

export interface ProviderCall {
  method: 'POST';
  path: string;
  body: Record<string, unknown>;
}

export function validateCreateTaskPayload(raw: unknown):
  | { ok: true; payload: CrmCreateTaskPayload }
  | { ok: false; errorCode: string; message: string } {
  const parsed = crmCreateTaskPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errorCode: 'INVALID_PAYLOAD', message: parsed.error.message };
  }
  const due = new Date(parsed.data.dueAt);
  if (Number.isNaN(due.getTime())) {
    return { ok: false, errorCode: 'INVALID_DUE_DATE', message: 'dueAt must be a valid ISO timestamp' };
  }
  return { ok: true, payload: parsed.data };
}

export function createTaskIdempotencyKey(p: {
  subaccountId: string;
  assigneeUserId: string;
  relatedContactId?: string | null;
  title: string;
  dueAt: string;
}): string {
  return [
    'crm.create_task',
    p.subaccountId,
    p.assigneeUserId,
    p.relatedContactId ?? 'no-contact',
    hashString(p.title),
    p.dueAt,
  ].join(':');
}

export function buildCreateTaskProviderCall(payload: CrmCreateTaskPayload): ProviderCall {
  return {
    method: 'POST',
    path: `/v1/tasks`,
    body: {
      assigneeUserId: payload.assigneeUserId,
      contactId: payload.relatedContactId,
      title: payload.title,
      notes: payload.notes,
      dueAt: payload.dueAt,
      priority: payload.priority,
    },
  };
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
