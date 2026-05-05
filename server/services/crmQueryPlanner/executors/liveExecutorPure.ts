// Live executor — pure translation layer (spec §13.2)
// Separated from liveExecutor.ts so tests can import translateToProviderQuery
// without pulling in the ghlReadHelpers → axios dependency chain.

import type { QueryPlan, QueryFilter, PrimaryEntity } from '../../../../shared/types/crmQueryPlanner.js';

// ── TranslatedGhlRead — local type for the plan → provider mapping ────────────

export type GhlEndpoint =
  | 'listContacts'
  | 'listOpportunities'
  | 'listAppointments'
  | 'listConversations'
  | 'listTasks'
  | 'listUsers';

export interface TranslatedGhlRead {
  endpoint: GhlEndpoint;
  params: Record<string, string | number | undefined>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractFilterValue(filters: QueryFilter[], field: string): string | undefined {
  const f = filters.find(f => f.field === field);
  return f ? String(f.value) : undefined;
}

function extractDateParam(plan: QueryPlan, param: 'from' | 'to'): string | undefined {
  return plan.dateContext?.[param];
}

// ── Pure translation ────────────────────────────────────────────────────────

export function translateToProviderQuery(plan: QueryPlan): TranslatedGhlRead {
  const { primaryEntity, filters, limit } = plan;

  switch (primaryEntity as PrimaryEntity) {
    case 'contacts':
      return {
        endpoint: 'listContacts',
        params: {
          limit,
          query: extractFilterValue(filters, 'email') ??
                 extractFilterValue(filters, 'firstName') ??
                 extractFilterValue(filters, 'lastName'),
        },
      };

    case 'opportunities':
      return {
        endpoint: 'listOpportunities',
        params: {
          limit,
          status:     extractFilterValue(filters, 'status'),
          pipelineId: extractFilterValue(filters, 'pipelineId'),
        },
      };

    case 'appointments':
      return {
        endpoint: 'listAppointments',
        params: {
          limit,
          startDate: extractDateParam(plan, 'from'),
          endDate:   extractDateParam(plan, 'to'),
        },
      };

    case 'conversations':
      return {
        endpoint: 'listConversations',
        params: {
          limit,
          status: extractFilterValue(filters, 'status'),
        },
      };

    case 'tasks':
      return {
        endpoint: 'listTasks',
        params: {
          limit,
          status:    extractFilterValue(filters, 'status'),
          contactId: extractFilterValue(filters, 'contactId'),
        },
      };

    default:
      return { endpoint: 'listContacts', params: { limit } };
  }
}

// ── Live-only field detection ──────────────────────────────────────────────
// Used by hybrid executor to split plan into canonical + live filters.

const LIVE_ONLY_FIELDS = new Set([
  'city', 'country', 'customFields', 'pipelineId', 'calendarId',
  'appointmentType', 'unreadCount', 'note', 'label',
]);

export function isLiveOnlyField(field: string): boolean {
  return LIVE_ONLY_FIELDS.has(field);
}

// ── Filter-composition diagnostics (spec §13.2) ───────────────────────────────
//
// `translateToProviderQuery` collapses email/firstName/lastName into a single
// `query` param for `listContacts` using `??` precedence (email → firstName →
// lastName). When more than one of those filters is present the translator
// silently drops the lower-priority ones. That is the pragmatic v1 mapping
// (GHL's search endpoint accepts a single free-text query), but it is also a
// correctness trap if the caller assumed AND composition.
//
// This helper reports which contact-filter fields were dropped when the
// translation fires, so the caller (`liveExecutor.ts`) can surface it via the
// repo's structured logger without adding a logger dependency to this pure
// module. Shape is a simple string array ordered by the precedence the
// translator actually applied.
const CONTACT_QUERY_FILTER_PRIORITY: readonly string[] = ['email', 'firstName', 'lastName'];

export function detectDroppedContactFilters(
  filters: Array<{ field: string }>,
): { picked: string | null; dropped: string[] } {
  const present = CONTACT_QUERY_FILTER_PRIORITY.filter((field) =>
    filters.some((f) => f.field === field),
  );
  if (present.length <= 1) return { picked: present[0] ?? null, dropped: [] };
  const [picked, ...dropped] = present;
  return { picked, dropped };
}
