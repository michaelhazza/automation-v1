import { expect, test } from 'vitest';
import { derivePendingIntervention, type PendingInterventionRow } from '../drilldownPendingInterventionPure.js';

const FIXED_DATE = new Date('2024-06-01T10:00:00.000Z');
const OLDER_DATE = new Date('2024-05-20T08:00:00.000Z');

const noop = (t: string) => t;
const labelMap = (t: string) => {
  const labels: Record<string, string> = {
    'crm.send_email': 'Send Email',
    'crm.fire_automation': 'Fire Automation',
    'crm.send_sms': 'Send SMS',
    'notify_operator': 'Notify Operator',
  };
  return labels[t] ?? t;
};

// ── 1. No rows → null ────────────────────────────────────────────────────────
test('no pending review items → null', () => {
  expect(derivePendingIntervention([], 'Acme Corp', labelMap)).toBe(null);
});

// ── 2. Single pending row → correct shape ────────────────────────────────────
test('one pending review item → non-null result with correct fields', () => {
  const rows: PendingInterventionRow[] = [
    {
      reviewItemId: 'ri-001',
      actionType: 'crm.send_email',
      payloadJsonReasoning: 'Client engagement dropped 40%.',
      proposedAt: FIXED_DATE,
    },
  ];

  const result = derivePendingIntervention(rows, 'Acme Corp', labelMap);

  expect(result).not.toBe(null);
  expect(result!.reviewItemId).toBe('ri-001');
  expect(result!.proposedAt).toBe(FIXED_DATE.toISOString());
  expect(result!.rationale).toBe('Client engagement dropped 40%.');
});

// ── 3. actionTitle is human-readable, not a raw slug ─────────────────────────
test('actionTitle uses human-readable label from lookup, not raw slug', () => {
  const rows: PendingInterventionRow[] = [
    {
      reviewItemId: 'ri-002',
      actionType: 'crm.send_email',
      payloadJsonReasoning: null,
      proposedAt: FIXED_DATE,
    },
  ];

  const result = derivePendingIntervention(rows, 'Beta LLC', labelMap);

  expect(result!.actionTitle).toBe('Send Email for Beta LLC');
});

// ── 4. Raw slug fallback when no label in registry ───────────────────────────
test('actionTitle falls back to raw actionType when lookup returns the same string', () => {
  const rows: PendingInterventionRow[] = [
    {
      reviewItemId: 'ri-003',
      actionType: 'custom.do_something',
      payloadJsonReasoning: null,
      proposedAt: FIXED_DATE,
    },
  ];

  // noop lookup → raw actionType returned
  const result = derivePendingIntervention(rows, 'Gamma Inc', noop);

  expect(result!.actionTitle).toBe('custom.do_something for Gamma Inc');
});

// ── 5. Multiple pending rows → most recent returned (first in caller-sorted list)
test('multiple pending rows — first row (most recent by createdAt) is returned', () => {
  const rows: PendingInterventionRow[] = [
    {
      reviewItemId: 'ri-newer',
      actionType: 'crm.fire_automation',
      payloadJsonReasoning: 'Newer reasoning.',
      proposedAt: FIXED_DATE,
    },
    {
      reviewItemId: 'ri-older',
      actionType: 'crm.send_email',
      payloadJsonReasoning: 'Older reasoning.',
      proposedAt: OLDER_DATE,
    },
  ];

  const result = derivePendingIntervention(rows, 'Delta Co', labelMap);

  expect(result!.reviewItemId).toBe('ri-newer');
  expect(result!.actionTitle).toBe('Fire Automation for Delta Co');
});

// ── 6. rationale from payloadJson.reasoning; empty string if absent ──────────
test('rationale is empty string when payloadJsonReasoning is null', () => {
  const rows: PendingInterventionRow[] = [
    {
      reviewItemId: 'ri-004',
      actionType: 'notify_operator',
      payloadJsonReasoning: null,
      proposedAt: FIXED_DATE,
    },
  ];

  const result = derivePendingIntervention(rows, 'Epsilon Ltd', labelMap);

  expect(result!.rationale).toBe('');
});

// ── 7. proposedAt accepts a string date and converts to ISO 8601 ─────────────
test('proposedAt string input is converted to ISO 8601', () => {
  const rows: PendingInterventionRow[] = [
    {
      reviewItemId: 'ri-005',
      actionType: 'crm.send_sms',
      payloadJsonReasoning: 'Some reason.',
      proposedAt: '2024-07-15T14:30:00.000Z',
    },
  ];

  const result = derivePendingIntervention(rows, 'Zeta Corp', labelMap);

  expect(result!.proposedAt).toBe('2024-07-15T14:30:00.000Z');
});
