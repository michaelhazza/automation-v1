/**
 * Pure helpers for ClientPulse signal observation shaping. No DB, no env, no
 * I/O — importable by both the runtime service (clientPulseIngestionService.ts)
 * and the Pure test suite.
 *
 * Spec: tasks/clientpulse-ghl-gap-analysis.md §§2, 4.3.
 */

import type {
  GhlFetchResult,
  GhlFunnel,
  GhlCalendar,
  GhlUser,
  GhlSubscription,
} from '../adapters/ghlAdapter.js';
import type { NewClientPulseSignalObservation, ObservationAvailability } from '../db/schema/clientPulseCanonicalTables.js';

// ── Signal slugs — referenced by Phase 2 scoring, Phase 3 churn, dashboards ──

export const CLIENT_PULSE_SIGNAL_SLUGS = [
  'staff_activity_pulse',
  'funnel_count',
  'calendar_quality',
  'contact_activity',
  'integration_fingerprint',
  'subscription_tier',
  'ai_feature_usage',
  'opportunity_pipeline',
] as const;

export type ClientPulseSignalSlug = typeof CLIENT_PULSE_SIGNAL_SLUGS[number];

type BaseObservation = Omit<NewClientPulseSignalObservation, 'signalSlug' | 'numericValue' | 'jsonPayload' | 'availability'>;

// ── funnel_count ─────────────────────────────────────────────────────────

export function observationFromFunnels(
  base: BaseObservation,
  result: GhlFetchResult<GhlFunnel[]>,
): NewClientPulseSignalObservation {
  if (result.availability === 'available') {
    return {
      ...base,
      signalSlug: 'funnel_count',
      numericValue: result.data.length,
      jsonPayload: { count: result.data.length, funnelIds: result.data.map((f) => f.id) },
      availability: 'available',
    };
  }
  return {
    ...base,
    signalSlug: 'funnel_count',
    numericValue: null,
    jsonPayload: { errorCode: 'errorCode' in result ? result.errorCode : 'unknown' },
    availability: result.availability as ObservationAvailability,
  };
}

// ── calendar_quality ─────────────────────────────────────────────────────

export function observationFromCalendars(
  base: BaseObservation,
  calResult: GhlFetchResult<GhlCalendar[]>,
  userResult: GhlFetchResult<GhlUser[]>,
): NewClientPulseSignalObservation {
  if (calResult.availability !== 'available') {
    return {
      ...base,
      signalSlug: 'calendar_quality',
      numericValue: null,
      jsonPayload: { errorCode: 'errorCode' in calResult ? calResult.errorCode : 'unknown' },
      availability: calResult.availability as ObservationAvailability,
    };
  }
  const calendars = calResult.data;
  const totalCalendars = calendars.length;
  const configuredCalendars = calendars.filter((c) => (c.teamMembers?.length ?? 0) > 0).length;
  const ratio = totalCalendars === 0 ? 0 : configuredCalendars / totalCalendars;
  const userCount = userResult.availability === 'available' ? userResult.data.filter((u) => !u.deleted).length : null;
  return {
    ...base,
    signalSlug: 'calendar_quality',
    numericValue: ratio * 100,
    jsonPayload: {
      totalCalendars,
      configuredCalendars,
      teamMemberCount: userCount,
    },
    availability: 'available',
  };
}

// ── subscription_tier ────────────────────────────────────────────────────

export function observationFromSubscription(
  base: BaseObservation,
  result: GhlFetchResult<GhlSubscription>,
): NewClientPulseSignalObservation {
  if (result.availability === 'available') {
    return {
      ...base,
      signalSlug: 'subscription_tier',
      numericValue: result.data.active ? 1 : 0,
      jsonPayload: {
        tier: result.data.tier ?? 'unknown',
        planId: result.data.planId,
        active: result.data.active,
        nextBillingDate: result.data.nextBillingDate,
      },
      availability: 'available',
    };
  }
  return {
    ...base,
    signalSlug: 'subscription_tier',
    numericValue: null,
    jsonPayload: { errorCode: 'errorCode' in result ? result.errorCode : 'unknown' },
    availability: result.availability as ObservationAvailability,
  };
}
