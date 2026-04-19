/**
 * Pure scorer for the Staff Activity Pulse signal (§2.0b).
 *
 * Reads a flat mutation stream + the org's staff-activity config and returns
 * a weighted-sum score per configured lookback window. The service wrapper
 * handles DB I/O; this module handles only the math.
 *
 * Runnable via: npx tsx server/services/__tests__/computeStaffActivityPulsePure.test.ts
 */

import type { StaffActivityDefinition } from './orgConfigService.js';
import type { ExternalUserKind } from '../db/schema/clientPulseCanonicalTables.js';

export interface MutationRow {
  occurredAt: Date;
  mutationType: string;
  externalUserKind: ExternalUserKind;
  externalUserId: string | null;
}

export interface StaffActivityResult {
  /** Primary numeric value written to the observation (score for the 30-day window if configured, else the longest window). */
  numericValue: number;
  jsonPayload: {
    windows: Array<{ days: number; weightedScore: number; rawMutationCount: number }>;
    countsByType: Record<string, number>;
    excludedUserKinds: string[];
    excludedUserMutationCount: number;
    automationVolumeThreshold: number;
    algorithm: 'weighted_sum_v1';
  };
}

const PRIMARY_WINDOW_DAYS_FALLBACK = 30;

export function computeStaffActivityPulse(
  mutations: MutationRow[],
  config: StaffActivityDefinition,
  now: Date = new Date(),
): StaffActivityResult {
  const typeWeights = new Map<string, number>();
  for (const row of config.countedMutationTypes ?? []) {
    typeWeights.set(row.type, row.weight);
  }
  const excluded = new Set(config.excludedUserKinds ?? []);
  const lookbacks = (config.lookbackWindowsDays ?? [PRIMARY_WINDOW_DAYS_FALLBACK]).slice().sort((a, b) => a - b);

  // Pre-filter: drop excluded user-kinds AND mutations whose type isn't in the
  // counted catalogue (unconfigured types contribute zero).
  let excludedUserMutationCount = 0;
  const eligible: MutationRow[] = [];
  for (const m of mutations) {
    if (excluded.has(m.externalUserKind)) {
      excludedUserMutationCount += 1;
      continue;
    }
    if (!typeWeights.has(m.mutationType)) continue;
    eligible.push(m);
  }

  const countsByType: Record<string, number> = {};
  for (const m of eligible) {
    countsByType[m.mutationType] = (countsByType[m.mutationType] ?? 0) + 1;
  }

  const windows = lookbacks.map((days) => {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    let weightedScore = 0;
    let rawMutationCount = 0;
    for (const m of eligible) {
      if (m.occurredAt < since) continue;
      weightedScore += typeWeights.get(m.mutationType) ?? 0;
      rawMutationCount += 1;
    }
    return { days, weightedScore: round2(weightedScore), rawMutationCount };
  });

  // Primary value: 30-day window if configured, else the longest window. This
  // keeps the signal comparable across orgs that have tuned their lookback
  // set but left 30-day in.
  const primary =
    windows.find((w) => w.days === PRIMARY_WINDOW_DAYS_FALLBACK) ??
    windows[windows.length - 1] ??
    { weightedScore: 0 };

  return {
    numericValue: primary.weightedScore,
    jsonPayload: {
      windows,
      countsByType,
      excludedUserKinds: [...excluded],
      excludedUserMutationCount,
      automationVolumeThreshold: config.automationUserResolution?.threshold ?? 0,
      algorithm: 'weighted_sum_v1',
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
