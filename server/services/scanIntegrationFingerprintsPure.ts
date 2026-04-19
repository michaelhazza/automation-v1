/**
 * Pure matcher for the Integration Fingerprint Scanner (§2.0c).
 *
 * Given a library of fingerprints (system + org scope) and a set of canonical
 * observations from one sub-account, returns matched detections grouped by
 * integration slug plus a list of unclassified observations that need
 * operator triage.
 *
 * The service wrapper handles DB I/O (library fetch, observation fetch,
 * detection/unclassified upserts, observation row write). This module
 * handles only the matching math.
 */

import type { IntegrationFingerprintType } from '../db/schema/clientPulseCanonicalTables.js';

export interface FingerprintLibraryEntry {
  id: string;
  integrationSlug: string;
  displayName: string;
  fingerprintType: IntegrationFingerprintType;
  fingerprintValue: string | null;
  fingerprintPattern: string | null;
  confidence: number;
}

export interface Observation {
  signalType: IntegrationFingerprintType;
  signalValue: string;
}

export interface MatchedDetection {
  integrationSlug: string;
  matchedFingerprintId: string;
  confidence: number;
  evidence: { signalType: IntegrationFingerprintType; signalValue: string };
}

export interface UnclassifiedSignal {
  signalType: IntegrationFingerprintType;
  signalValue: string;
}

export interface ScanResult {
  detections: MatchedDetection[];
  unclassified: UnclassifiedSignal[];
}

/**
 * Returns the best-match detection per observation (highest confidence wins).
 * Observations that match nothing are collected into `unclassified`.
 */
export function scanFingerprintsPure(
  observations: Observation[],
  library: FingerprintLibraryEntry[],
): ScanResult {
  // Index library by signal type for faster lookup.
  const byType = new Map<IntegrationFingerprintType, FingerprintLibraryEntry[]>();
  for (const entry of library) {
    const list = byType.get(entry.fingerprintType) ?? [];
    list.push(entry);
    byType.set(entry.fingerprintType, list);
  }

  // Collapse to one detection per (integrationSlug) — if a sub-account hits
  // CloseBot via 3 patterns, we want ONE integration_detections row, not 3.
  const bySlug = new Map<string, MatchedDetection>();
  const unclassified: UnclassifiedSignal[] = [];

  for (const obs of observations) {
    const candidates = byType.get(obs.signalType) ?? [];
    let best: { entry: FingerprintLibraryEntry } | null = null;
    for (const entry of candidates) {
      if (!matchesFingerprint(entry, obs.signalValue)) continue;
      if (!best || entry.confidence > best.entry.confidence) {
        best = { entry };
      }
    }
    if (best) {
      const existing = bySlug.get(best.entry.integrationSlug);
      if (!existing || best.entry.confidence > existing.confidence) {
        bySlug.set(best.entry.integrationSlug, {
          integrationSlug: best.entry.integrationSlug,
          matchedFingerprintId: best.entry.id,
          confidence: best.entry.confidence,
          evidence: { signalType: obs.signalType, signalValue: obs.signalValue },
        });
      }
    } else {
      unclassified.push({ signalType: obs.signalType, signalValue: obs.signalValue });
    }
  }

  return {
    detections: [...bySlug.values()],
    unclassified,
  };
}

export function matchesFingerprint(entry: FingerprintLibraryEntry, observedValue: string): boolean {
  if (entry.fingerprintValue !== null) {
    return entry.fingerprintValue === observedValue;
  }
  if (entry.fingerprintPattern !== null) {
    try {
      const re = new RegExp(entry.fingerprintPattern);
      return re.test(observedValue);
    } catch {
      // Malformed pattern — treat as non-matching rather than throwing. The
      // governance surface (template editor) is the right place to validate
      // patterns; the runtime matcher must never crash a scan cycle.
      return false;
    }
  }
  // Library entries must declare at least one of value/pattern (schema CHECK
  // enforces this). Defensive fallback — never match if neither set.
  return false;
}
