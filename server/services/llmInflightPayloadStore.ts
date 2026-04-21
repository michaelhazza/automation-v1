// ---------------------------------------------------------------------------
// In-memory payload snapshot store for the live In-Flight tab drawer.
//
// Deferred-items brief §7. Admins can click a live row to see the prompt
// that was dispatched. Payloads are captured at dispatch time, bounded
// LRU-evicted at ~100 entries, and cleared when the runtimeKey is
// removed from the in-flight registry.
//
// Posture:
//   - SYSTEM-ADMIN-ONLY reads via the /api/admin/llm-pnl/in-flight/:runtimeKey/payload
//     route. Payloads contain raw prompt content — same sensitivity as the
//     post-completion ledger detail drawer but with a wider exposure window.
//   - Bounded memory: LRU cap at MAX_PAYLOAD_SNAPSHOTS. Per-payload byte
//     cap at MAX_PAYLOAD_BYTES drops the body and stores a marker instead
//     so a single runaway prompt can't push out 100 unrelated entries.
//   - Fire-and-forget writes: store.set() never throws.
// ---------------------------------------------------------------------------

import { logger } from '../lib/logger.js';

/** Cap on the number of payload snapshots held in memory. */
export const MAX_PAYLOAD_SNAPSHOTS = 100;
/** Cap on the serialised size of a single payload snapshot (bytes). */
export const MAX_PAYLOAD_BYTES = 200_000;   // ~200 KB

export interface PayloadSnapshot {
  messages:  unknown;                       // mirrors ProviderMessage[] shape
  system?:   unknown;
  tools?:    unknown;
  maxTokens?: number;
  temperature?: number;
  capturedAt: string;                       // ISO 8601 UTC
  /** True when the full body was dropped (exceeded MAX_PAYLOAD_BYTES). */
  truncated: boolean;
}

// Map preserves insertion order in JS — we exploit that for LRU eviction.
const store = new Map<string, PayloadSnapshot>();

/** Capture a payload snapshot keyed by runtimeKey. Safe under memory pressure. */
export function set(runtimeKey: string, snapshot: Omit<PayloadSnapshot, 'capturedAt' | 'truncated'>): void {
  try {
    let body: PayloadSnapshot;
    let truncated = false;
    // Cheap size gate — JSON.stringify the full snapshot to estimate bytes.
    // Measuring only `messages` bypasses the guard for calls with a small
    // messages array but a large system prompt or tool schema (both of which
    // can easily exceed 200 KB on complex agents). Serialize the whole object
    // so the cap is applied to the true stored footprint.
    const serialised = JSON.stringify(snapshot);
    if (serialised.length > MAX_PAYLOAD_BYTES) {
      truncated = true;
      body = {
        messages:  null,
        capturedAt: new Date().toISOString(),
        truncated,
      };
    } else {
      body = {
        ...snapshot,
        capturedAt: new Date().toISOString(),
        truncated,
      };
    }
    // LRU eviction: refresh insertion order by delete + re-set.
    store.delete(runtimeKey);
    store.set(runtimeKey, body);
    while (store.size > MAX_PAYLOAD_SNAPSHOTS) {
      const oldest = store.keys().next().value;
      if (typeof oldest === 'string') store.delete(oldest);
      else break;
    }
  } catch (err) {
    logger.warn('inflight.payload_store_set_failed', {
      runtimeKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function get(runtimeKey: string): PayloadSnapshot | null {
  const snap = store.get(runtimeKey);
  if (!snap) return null;
  // Touch for LRU — move to most-recently-used position.
  store.delete(runtimeKey);
  store.set(runtimeKey, snap);
  return snap;
}

export function remove(runtimeKey: string): void {
  store.delete(runtimeKey);
}

/** Test-only — clears the map. Never called in prod. */
export function _resetForTests(): void {
  store.clear();
}

/** Test-only — size introspection. */
export function _size(): number {
  return store.size;
}
