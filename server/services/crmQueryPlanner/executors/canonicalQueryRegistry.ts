// Canonical query registry — spec §12.2
// Imports pure metadata from canonicalQueryRegistryMeta.ts and binds handlers.

import { canonicalDataService } from '../../canonicalDataService.js';
import { fromOrgId } from '../../principal/fromOrgId.js';
import { REGISTRY_META } from './canonicalQueryRegistryMeta.js';
import type {
  CanonicalQueryRegistry,
  CanonicalQueryHandlerArgs,
  ExecutorResult,
  NormalisedIntent,
  ParsedArgs,
} from '../../../../shared/types/crmQueryPlanner.js';

// ── Pure helpers ──────────────────────────────────────────────────────────

function resolveSinceDaysAgo(args: CanonicalQueryHandlerArgs): number {
  // Extract numeric day count from filters or dateContext
  for (const f of args.filters) {
    if (f.field === 'updatedAt' && (f.operator === 'lt' || f.operator === 'lte')) {
      const v = Number(f.value);
      if (!isNaN(v) && v > 0) return v;
    }
  }
  if (args.dateContext?.kind === 'relative' && args.dateContext.description) {
    const m = args.dateContext.description.match(/(\d+)/);
    if (m) return parseInt(m[1]!, 10);
  }
  return 30; // default 30-day window
}

function parseDateToken(token: string): number | null {
  const m = token.match(/^last_(\d+)d$/);
  return m ? parseInt(m[1]!, 10) : null;
}

// ── Registry handlers ─────────────────────────────────────────────────────

async function contactsInactiveOverDaysHandler(
  args: CanonicalQueryHandlerArgs,
): Promise<ExecutorResult> {
  const sinceDaysAgo = resolveSinceDaysAgo(args);
  const result = await canonicalDataService.listInactiveContacts({
    orgId:        args.orgId,
    subaccountId: args.subaccountId,
    sinceDaysAgo,
    limit:        args.limit,
  });
  return {
    ...result,
    actualCostCents: 0, // canonical reads are free
    source: 'canonical',
  };
}

async function accountsAtRiskBandHandler(
  args: CanonicalQueryHandlerArgs,
): Promise<ExecutorResult> {
  const bandFilter = args.filters.find(f => f.field === 'band');
  const band = (bandFilter?.value as string) ?? 'red';
  const result = await canonicalDataService.getAccountsAtRiskBand({
    orgId:        args.orgId,
    subaccountId: args.subaccountId,
    band:         band as 'red' | 'yellow' | 'green',
    limit:        args.limit,
  });
  return { ...result, actualCostCents: 0, source: 'canonical' };
}

async function pipelineVelocityHandler(
  args: CanonicalQueryHandlerArgs,
): Promise<ExecutorResult> {
  const from = args.dateContext?.from ? new Date(args.dateContext.from) : new Date(Date.now() - 30 * 86400_000);
  const to   = args.dateContext?.to   ? new Date(args.dateContext.to)   : new Date();
  const result = await canonicalDataService.getPipelineVelocity({
    orgId:        args.orgId,
    subaccountId: args.subaccountId,
    from,
    to,
  });
  return { ...result, actualCostCents: 0, source: 'canonical' };
}

async function staleOpportunitiesHandler(
  args: CanonicalQueryHandlerArgs,
): Promise<ExecutorResult> {
  const sinceDaysAgo = resolveSinceDaysAgo(args);
  const stageFilter  = args.filters.find(f => f.field === 'stage');
  const result = await canonicalDataService.listStaleOpportunities({
    orgId:        args.orgId,
    subaccountId: args.subaccountId,
    stageKey:     stageFilter?.value as string | undefined,
    staleSince:   new Date(Date.now() - sinceDaysAgo * 86400_000),
    limit:        args.limit,
  });
  return { ...result, actualCostCents: 0, source: 'canonical' };
}

async function upcomingAppointmentsHandler(
  args: CanonicalQueryHandlerArgs,
): Promise<ExecutorResult> {
  const from = args.dateContext?.from ? new Date(args.dateContext.from) : new Date();
  const to   = args.dateContext?.to   ? new Date(args.dateContext.to)   : new Date(Date.now() + 7 * 86400_000);
  const result = await canonicalDataService.listUpcomingAppointments({
    orgId:        args.orgId,
    subaccountId: args.subaccountId,
    from,
    to,
    limit:        args.limit,
  });
  return { ...result, actualCostCents: 0, source: 'canonical' };
}

async function contactsByTagHandler(
  args: CanonicalQueryHandlerArgs,
): Promise<ExecutorResult> {
  const result = await canonicalDataService.countContactsByTag({
    orgId:        args.orgId,
    subaccountId: args.subaccountId,
  });
  return { ...result, actualCostCents: 0, source: 'canonical' };
}

async function opportunitiesByStageHandler(
  args: CanonicalQueryHandlerArgs,
): Promise<ExecutorResult> {
  const result = await canonicalDataService.countOpportunitiesByStage({
    orgId:        args.orgId,
    subaccountId: args.subaccountId,
  });
  return { ...result, actualCostCents: 0, source: 'canonical' };
}

async function revenueTrendHandler(
  args: CanonicalQueryHandlerArgs,
): Promise<ExecutorResult> {
  const from = args.dateContext?.from ? new Date(args.dateContext.from) : new Date(Date.now() - 30 * 86400_000);
  const to   = args.dateContext?.to   ? new Date(args.dateContext.to)   : new Date();
  const result = await canonicalDataService.getRevenueTrend({
    orgId:        args.orgId,
    subaccountId: args.subaccountId,
    from,
    to,
    limit:        args.limit,
  });
  return { ...result, actualCostCents: 0, source: 'canonical' };
}

// ── parseArgs helpers ─────────────────────────────────────────────────────

function parseDaysArgs(intent: NormalisedIntent): ParsedArgs | null {
  for (const token of intent.tokens) {
    const days = parseDateToken(token);
    if (days !== null) {
      return {
        dateContext: { kind: 'relative', description: `${days} days` },
        limit: 100,
      };
    }
  }
  return { limit: 100 }; // default: no day filter extracted (use handler default)
}

// ── Registry (all 8 v1 entries — spec §12.2) ──────────────────────────────

export const canonicalQueryRegistry: CanonicalQueryRegistry = Object.freeze({
  'contacts.inactive_over_days': {
    ...REGISTRY_META['contacts.inactive_over_days']!,
    handler: contactsInactiveOverDaysHandler,
    parseArgs: parseDaysArgs,
  },
  'accounts.at_risk_band': {
    ...REGISTRY_META['accounts.at_risk_band']!,
    handler: accountsAtRiskBandHandler,
  },
  'opportunities.pipeline_velocity': {
    ...REGISTRY_META['opportunities.pipeline_velocity']!,
    handler: pipelineVelocityHandler,
  },
  'opportunities.stale_over_days': {
    ...REGISTRY_META['opportunities.stale_over_days']!,
    handler: staleOpportunitiesHandler,
    parseArgs: parseDaysArgs,
  },
  'appointments.upcoming': {
    ...REGISTRY_META['appointments.upcoming']!,
    handler: upcomingAppointmentsHandler,
  },
  'contacts.count_by_tag': {
    ...REGISTRY_META['contacts.count_by_tag']!,
    handler: contactsByTagHandler,
  },
  'opportunities.count_by_stage': {
    ...REGISTRY_META['opportunities.count_by_stage']!,
    handler: opportunitiesByStageHandler,
  },
  'revenue.trend_over_range': {
    ...REGISTRY_META['revenue.trend_over_range']!,
    handler: revenueTrendHandler,
  },
});
