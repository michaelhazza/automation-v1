// Live executor — dispatches GHL read calls for Stage 3 live plans (spec §13)
// Read-only by structural import restriction: only ghlReadHelpers is imported.

import { getProviderRateLimiter } from '../../../lib/rateLimiter.js';
import { resolveGhlContext } from '../../adapters/ghlReadHelpers.js';
import {
  listGhlContacts,
  listGhlOpportunities,
  listGhlAppointments,
  listGhlConversations,
  listGhlTasks,
  listGhlUsers,
} from '../../adapters/ghlReadHelpers.js';
import { translateToProviderQuery } from './liveExecutorPure.js';
import type { TranslatedGhlRead } from './liveExecutorPure.js';
import type {
  QueryPlan,
} from '../../../../shared/types/crmQueryPlanner.js';
import type { ExecutorResult, ExecutorContext } from '../../../../shared/types/crmQueryPlanner.js';

export { translateToProviderQuery } from './liveExecutorPure.js';

// ── Dispatch layer ─────────────────────────────────────────────────────────

type GhlContext = Awaited<ReturnType<typeof resolveGhlContext>> & {};

async function dispatchGhlRead(
  translated: TranslatedGhlRead,
  ghlCtx: GhlContext,
): Promise<{ items: unknown[]; ok: true } | { ok: false; rateLimited: true; retryAfterSeconds: number } | { ok: false; error: string; statusCode?: number }> {
  const p = translated.params as Record<string, string | number | undefined>;

  switch (translated.endpoint) {
    case 'listContacts': {
      const r = await listGhlContacts(ghlCtx, p.query as string | undefined);
      if (!r.ok) return r;
      return { ok: true, items: r.items };
    }
    case 'listOpportunities': {
      const r = await listGhlOpportunities(ghlCtx, {
        limit:      typeof p.limit === 'number' ? p.limit : undefined,
        status:     p.status as string | undefined,
        pipelineId: p.pipelineId as string | undefined,
      });
      if (!r.ok) return r;
      return { ok: true, items: r.items };
    }
    case 'listAppointments': {
      const r = await listGhlAppointments(ghlCtx, {
        limit:     typeof p.limit === 'number' ? p.limit : undefined,
        startDate: p.startDate as string | undefined,
        endDate:   p.endDate as string | undefined,
      });
      if (!r.ok) return r;
      return { ok: true, items: r.items };
    }
    case 'listConversations': {
      const r = await listGhlConversations(ghlCtx, {
        limit:  typeof p.limit === 'number' ? p.limit : undefined,
        status: p.status as string | undefined,
      });
      if (!r.ok) return r;
      return { ok: true, items: r.items };
    }
    case 'listTasks': {
      const r = await listGhlTasks(ghlCtx, {
        limit:     typeof p.limit === 'number' ? p.limit : undefined,
        status:    p.status as string | undefined,
        contactId: p.contactId as string | undefined,
      });
      if (!r.ok) return r;
      return { ok: true, items: r.items };
    }
    case 'listUsers': {
      const r = await listGhlUsers(ghlCtx);
      if (!r.ok) return r;
      return { ok: true, items: r.items };
    }
  }
}

// ── Live executor ──────────────────────────────────────────────────────────

export class LiveExecutorError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'LiveExecutorError';
    this.errorCode = errorCode;
  }
}

export async function executeLive(
  plan: QueryPlan,
  context: ExecutorContext,
): Promise<ExecutorResult> {
  if (plan.source !== 'live') {
    throw new Error('liveExecutor dispatched with non-live plan');
  }

  // Resolve GHL credentials for the subaccount
  const ghlCtx = await resolveGhlContext({
    organisationId: context.organisationId,
    subaccountId:   context.subaccountId,
  });
  if (!ghlCtx) {
    throw new LiveExecutorError('no_ghl_connection', 'No active GHL connection for this subaccount');
  }

  // Acquire rate-limiter token (keyed on locationId — shared with ClientPulse polling)
  const limiterKey = context.subaccountLocationId ?? context.subaccountId;
  await getProviderRateLimiter('ghl').acquire(limiterKey);

  const translated = translateToProviderQuery(plan);
  const startedAt = Date.now();
  const dispatchResult = await dispatchGhlRead(translated, ghlCtx);
  const latencyMs = Date.now() - startedAt;

  if (!dispatchResult.ok) {
    if ('rateLimited' in dispatchResult && dispatchResult.rateLimited) {
      throw new LiveExecutorError('rate_limited', `GHL rate limited; retry after ${dispatchResult.retryAfterSeconds}s`);
    }
    throw new LiveExecutorError(
      `ghl_error_${(dispatchResult as { statusCode?: number }).statusCode ?? 'unknown'}`,
      (dispatchResult as { error: string }).error || 'GHL request failed',
    );
  }

  const allRows = dispatchResult.items as Array<Record<string, unknown>>;
  const truncated = allRows.length > plan.limit;
  const rows = truncated ? allRows.slice(0, plan.limit) : allRows;

  return {
    rows,
    rowCount: rows.length,
    truncated,
    truncationReason: truncated ? 'result_limit' : undefined,
    actualCostCents:  0,  // live reads are not billed per-call in v1
    source:           'live',
    providerLatencyMs: latencyMs,
  };
}
