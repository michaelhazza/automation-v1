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
