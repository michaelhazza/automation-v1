// ---------------------------------------------------------------------------
// LLM in-flight registry — spec tasks/llm-inflight-realtime-tracker-spec.md.
//
// Per-process Map<runtimeKey, RegistrySlot> + Socket.IO broadcast to the
// `system:llm-inflight` room + optional Redis pub/sub fanout when the env
// var `REDIS_URL` is set and the ioredis module is available.
//
// Redis posture:
//   Spec §3 assumes a Redis client is already present via the pg-boss queue
//   stack — that's factually off (pg-boss uses Postgres). This module ships
//   local-only by default and dynamically imports `ioredis` when `REDIS_URL`
//   is set; if the module isn't installed, it logs once and continues
//   local-only. Adding the dependency is a separate decision — the feature
//   works fine single-instance without it, and all of the state-machine
//   guards (monotonic stateVersion, stale-event filter, eventId dedup) still
//   apply if a future Redis wiring lands.
//
// Every impure edge of this module delegates the state-machine decision to
// `llmInflightRegistryPure.ts` — add/remove/incoming-event outcomes all
// come from there, so the behaviour tested by the pure suite mirrors exactly
// what fires on the wire.
// ---------------------------------------------------------------------------

import { createEvent } from '../lib/tracing.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { getIO } from '../websocket/index.js';
import {
  MAX_INFLIGHT_ENTRIES,
  INFLIGHT_SWEEP_INTERVAL_MS,
  INFLIGHT_SWEEP_JITTER_MS,
  INFLIGHT_DEADLINE_BUFFER_MS,
  INFLIGHT_SNAPSHOT_HARD_CAP,
} from '../config/limits.js';
import {
  applyAdd,
  applyIncomingEvent,
  applyRemove,
  buildActiveCountPayload,
  buildEntry,
  buildSnapshot,
  selectEvictionVictim,
  selectStaleEntries,
  type BuildEntryInput,
  type RegistrySlot,
} from './llmInflightRegistryPure.js';
import type {
  InFlightEntry,
  InFlightEventEnvelope,
  InFlightRemoval,
  InFlightSnapshotResponse,
  InFlightTerminalStatus,
  InFlightSweepReason,
  InFlightEvictionContext,
} from '../../shared/types/systemPnl.js';

// ── Constants ─────────────────────────────────────────────────────────────

const ROOM = 'system:llm-inflight';
const REDIS_CHANNEL = 'llm-inflight';
const EVENT_ADDED = 'llm-inflight:added';
const EVENT_REMOVED = 'llm-inflight:removed';

// ── Internal state ────────────────────────────────────────────────────────

const slots = new Map<string, RegistrySlot>();

// Instance ID stamped on every outbound Redis message so this process
// ignores its own fanout (double-delivery avoidance).
const INSTANCE_ID = `${process.pid}-${Date.now().toString(36)}`;

let sweepTimer: NodeJS.Timeout | null = null;
let stopped = false;

// Redis pub/sub — populated asynchronously when REDIS_URL is set and the
// ioredis module is loadable. All redis access is through dynamic imports
// so the module is optional at runtime.
type RedisClient = {
  publish: (channel: string, message: string) => Promise<number> | number;
  subscribe: (channel: string, cb?: (err: Error | null, count: number) => void) => unknown;
  on: (event: string, cb: (...args: unknown[]) => void) => unknown;
  quit: () => Promise<void> | void;
};
let redisPub: RedisClient | null = null;
let redisSub: RedisClient | null = null;
let redisInitTried = false;

// ── Public API ────────────────────────────────────────────────────────────

export interface RegistryAddInput extends Omit<BuildEntryInput, 'deadlineBufferMs'> {
  /** Defaults to `INFLIGHT_DEADLINE_BUFFER_MS`. */
  deadlineBufferMs?: number;
}

/**
 * Register an in-flight call. Fires:
 *   - Socket emit on room `system:llm-inflight`, event `llm-inflight:added`.
 *   - Redis publish on channel `llm-inflight` (when configured).
 *   - `createEvent('llm.inflight.active_count', ...)` gauge.
 *
 * Returns the runtimeKey. Idempotent — calling twice with the same runtimeKey
 * is a no-op with a debug log (`add_noop_already_exists`).
 */
export function add(input: RegistryAddInput): string {
  const entry = buildEntry({
    ...input,
    deadlineBufferMs: input.deadlineBufferMs ?? INFLIGHT_DEADLINE_BUFFER_MS,
  });

  // No-op check FIRST. If this runtimeKey already exists we must not touch
  // the map — in particular, we must not run overflow eviction, which
  // would otherwise evict an unrelated entry and emit a spurious
  // `evicted_overflow` event when this add() is a no-op (see pr-review
  // log §1 — double-add at capacity race).
  const outcome = applyAdd({ entry, existing: slots.get(entry.runtimeKey) });
  if (outcome.kind === 'noop_already_exists') {
    logger.debug('inflight.add_noop_already_exists', {
      runtimeKey: entry.runtimeKey,
    });
    return entry.runtimeKey;
  }

  // Overflow check — only runs on genuine new entries. Evict the oldest
  // active slot to make room, emitting a real `evicted_overflow` event.
  //
  // Use countActive() rather than slots.size so that 'removed' slots
  // retained for the 30-second dedup window don't inflate the count and
  // cause premature eviction of still-active entries under churn.
  if (countActive() >= MAX_INFLIGHT_ENTRIES) {
    const victim = selectEvictionVictim(slots.values());
    if (victim) {
      evictVictim(victim);
    }
  }

  slots.set(entry.runtimeKey, outcome.slot);
  broadcast(EVENT_ADDED, outcome.envelope);
  publishToRedis({ kind: 'added', envelope: outcome.envelope });
  emitActiveCount();
  return entry.runtimeKey;
}

export interface RegistryRemoveInput {
  runtimeKey:        string;
  terminalStatus:    InFlightTerminalStatus;
  completedAt?:      string;
  ledgerRowId?:      string | null;
  ledgerCommittedAt?: string | null;
  sweepReason?:      InFlightSweepReason | null;
  evictionContext?:  InFlightEvictionContext | null;
}

/**
 * Record completion of an in-flight call. Fires a socket + Redis event
 * with `stateVersion: 2`. Idempotent.
 */
export function remove(input: RegistryRemoveInput): void {
  const existing = slots.get(input.runtimeKey);
  const outcome = applyRemove({
    runtimeKey:        input.runtimeKey,
    terminalStatus:    input.terminalStatus,
    completedAt:       input.completedAt ?? new Date().toISOString(),
    ledgerRowId:       input.ledgerRowId ?? null,
    ledgerCommittedAt: input.ledgerCommittedAt ?? null,
    sweepReason:       input.sweepReason ?? null,
    evictionContext:   input.evictionContext ?? null,
    existing,
  });
  if (outcome.kind === 'noop_already_removed') {
    logger.debug('inflight.remove_noop_already_removed', {
      runtimeKey: input.runtimeKey,
      source:     'local',
    });
    return;
  }
  if (outcome.kind === 'noop_missing_key') {
    logger.debug('inflight.remove_noop_missing_key', {
      runtimeKey: input.runtimeKey,
      source:     'local',
    });
    return;
  }

  // Keep the slot visible as 'removed' briefly so a late duplicate add
  // (local or Redis fanout) can be identified by the state-machine guard
  // rather than being accepted as a fresh entry. A short retention window
  // is enough — the map is bounded and the guard is conservative.
  slots.set(input.runtimeKey, outcome.slot);
  scheduleSlotPrune(input.runtimeKey);

  broadcast(EVENT_REMOVED, outcome.envelope);
  publishToRedis({ kind: 'removed', envelope: outcome.envelope });
  emitActiveCount();
}

/**
 * Non-mutating read of the current map — used by the router-side pre-add
 * invariant `assert(!registry.has(runtimeKey))` (spec §6 llmRouter.ts row).
 */
export function has(runtimeKey: string): boolean {
  const slot = slots.get(runtimeKey);
  return slot !== undefined && slot.state === 'active';
}

/**
 * Ledger-link rehydration — emit a follow-up `removed` event for an
 * already-removed runtimeKey so the client's `recentlyLanded` map picks
 * up the ledger linkage.
 *
 * Use case (pr-review feedback): when a retry chain exhausts all
 * retryable errors, the inner catch already removed each attempt's
 * entry with `ledgerRowId=null` (the ledger row hadn't been written
 * yet). The outer failure path then writes the ledger row and knows
 * the id, but the original entry is gone, so `remove()` would be a
 * noop and the `[ledger]` button never appears in "Recently landed".
 *
 * This method bypasses the state-machine noop path and emits a
 * standalone event with the same `stateVersion: 2` tag the original
 * removal carried. The client's `applyRemoveEntry` handles duplicate
 * removes gracefully — it merges the new `ledgerRowId` +
 * `ledgerCommittedAt` over any previously-null values.
 *
 * No local state change, no Redis publish (the origin instance already
 * fanned out the first removal). Socket emission only.
 */
export function updateLedgerLink(input: {
  runtimeKey:        string;
  idempotencyKey:    string;
  attempt:           number;
  terminalStatus:    InFlightTerminalStatus;
  completedAt:       string;
  durationMs:        number;
  ledgerRowId:       string;
  ledgerCommittedAt: string;
}): void {
  const removal: InFlightRemoval = {
    runtimeKey:        input.runtimeKey,
    idempotencyKey:    input.idempotencyKey,
    attempt:           input.attempt,
    stateVersion:      2,
    terminalStatus:    input.terminalStatus,
    sweepReason:       null,
    evictionContext:   null,
    completedAt:       input.completedAt,
    durationMs:        input.durationMs,
    ledgerRowId:       input.ledgerRowId,
    ledgerCommittedAt: input.ledgerCommittedAt,
  };
  const envelope: InFlightEventEnvelope<InFlightRemoval> = {
    eventId:   `${input.runtimeKey}:removed:ledger-link`,
    type:      'removed',
    entityId:  input.runtimeKey,
    timestamp: new Date().toISOString(),
    payload:   removal,
  };
  broadcast(EVENT_REMOVED, envelope);
  logger.debug('inflight.ledger_link_rehydrated', {
    runtimeKey:  input.runtimeKey,
    ledgerRowId: input.ledgerRowId,
  });
}

/**
 * Build a snapshot for the admin snapshot endpoint. Entries are sorted
 * `startedAt DESC, runtimeKey DESC` and capped at `limit` (clamped to
 * `INFLIGHT_SNAPSHOT_HARD_CAP`).
 */
export function snapshot(limit: number): InFlightSnapshotResponse {
  return buildSnapshot({
    slots:       slots.values(),
    limit,
    hardCap:     INFLIGHT_SNAPSHOT_HARD_CAP,
    generatedAt: new Date().toISOString(),
  });
}

// ── Lifecycle — called from server startup / shutdown ─────────────────────

/**
 * Start the deadline-based sweep timer + attempt Redis wiring. Safe to
 * call many times — no-op on repeat. Call once from server startup.
 */
export function init(): void {
  if (stopped) stopped = false;
  scheduleNextSweep();
  if (!redisInitTried && env.REDIS_URL) {
    redisInitTried = true;
    void initRedis(env.REDIS_URL).catch((err) => {
      logger.warn('inflight.redis_init_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/** Stop timers + disconnect Redis. Used by tests + graceful shutdown. */
export async function shutdown(): Promise<void> {
  stopped = true;
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
  if (redisSub) {
    try { await redisSub.quit(); } catch { /* ignore */ }
    redisSub = null;
  }
  if (redisPub) {
    try { await redisPub.quit(); } catch { /* ignore */ }
    redisPub = null;
  }
}

/** Test-only helper — clears the in-memory map. Never called in prod. */
export function _resetForTests(): void {
  slots.clear();
}

// ── Internals ─────────────────────────────────────────────────────────────

function broadcast(event: string, envelope: InFlightEventEnvelope<unknown>): void {
  const io = getIO();
  if (!io) return;
  io.to(ROOM).emit(event, envelope);
}

function emitActiveCount(): void {
  const payload = buildActiveCountPayload(slots.values());
  createEvent('llm.inflight.active_count', {
    activeCount: payload.activeCount,
    byCallSite:  payload.byCallSite,
    byProvider:  payload.byProvider,
  });
}

function evictVictim(victim: RegistrySlot): void {
  // `activeCount` is counted BEFORE the remove() call, so the victim is
  // still in the map. That is intentional: the operator signal in spec
  // §4.4 is "we saw capacity-many active entries and had to evict to
  // make room" — the victim being counted pins the fact that the map
  // was at capacity at eviction time, which is what distinguishes real
  // overload from a post-sweep leak.
  const evictionContext: InFlightEvictionContext = {
    activeCount: countActive(),
    capacity:    MAX_INFLIGHT_ENTRIES,
  };
  logger.warn('inflight.evicted_overflow', {
    runtimeKey:      victim.entry.runtimeKey,
    evictionContext,
  });
  // Route through remove() so the socket + Redis fanout + active-count
  // gauge fire consistently. Use `completedAt: now` and no ledger row.
  remove({
    runtimeKey:      victim.entry.runtimeKey,
    terminalStatus:  'evicted_overflow',
    completedAt:     new Date().toISOString(),
    ledgerRowId:     null,
    ledgerCommittedAt: null,
    sweepReason:     null,
    evictionContext,
  });
}

function countActive(): number {
  let n = 0;
  for (const slot of slots.values()) {
    if (slot.state === 'active') n++;
  }
  return n;
}

// ── Removed-slot retention / prune ────────────────────────────────────────

// How long we keep a 'removed' slot in the map before pruning. Longer than
// realistic Redis / socket fanout latency so a late duplicate add/remove
// for the same runtimeKey is still caught by the state-machine guard.
const REMOVED_SLOT_RETENTION_MS = 30_000;

function scheduleSlotPrune(runtimeKey: string): void {
  setTimeout(() => {
    const slot = slots.get(runtimeKey);
    if (slot && slot.state === 'removed') {
      slots.delete(runtimeKey);
    }
  }, REMOVED_SLOT_RETENTION_MS).unref?.();
}

// ── Stale-entry sweep ─────────────────────────────────────────────────────

function scheduleNextSweep(): void {
  if (stopped) return;
  const jitter = Math.floor((Math.random() * 2 - 1) * INFLIGHT_SWEEP_JITTER_MS);
  const delay = Math.max(0, INFLIGHT_SWEEP_INTERVAL_MS + jitter);
  sweepTimer = setTimeout(runSweep, delay);
  sweepTimer.unref?.();
}

function runSweep(): void {
  if (stopped) return;
  try {
    const nowMs = Date.now();
    const stale = selectStaleEntries({ slots: slots.values(), nowMs });
    if (stale.length > 0) {
      logger.warn('inflight.sweep_removed_stale_entries', {
        count: stale.length,
      });
      for (const slot of stale) {
        remove({
          runtimeKey:      slot.entry.runtimeKey,
          terminalStatus:  'swept_stale',
          completedAt:     new Date().toISOString(),
          sweepReason:     'deadline_exceeded',
          ledgerRowId:     null,
          ledgerCommittedAt: null,
          evictionContext: null,
        });
      }
    }
  } catch (err) {
    logger.error('inflight.sweep_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    scheduleNextSweep();
  }
}

// ── Redis pub/sub ─────────────────────────────────────────────────────────

interface RedisMessage {
  origin:   string;             // instance id — skip if own
  kind:     'added' | 'removed';
  envelope: InFlightEventEnvelope<InFlightEntry | InFlightRemoval>;
}

function publishToRedis(args: {
  kind: 'added' | 'removed';
  envelope: InFlightEventEnvelope<InFlightEntry | InFlightRemoval>;
}): void {
  if (!redisPub) return;
  const msg: RedisMessage = {
    origin:   INSTANCE_ID,
    kind:     args.kind,
    envelope: args.envelope,
  };
  try {
    const result = redisPub.publish(REDIS_CHANNEL, JSON.stringify(msg));
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch((err) => {
        logger.warn('inflight.redis_publish_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } catch (err) {
    logger.warn('inflight.redis_publish_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function initRedis(url: string): Promise<void> {
  let Redis: unknown;
  try {
    // Dynamic `import()` via string variable so TypeScript doesn't try to
    // resolve the `ioredis` module at compile time. The module is optional —
    // if it's not installed, we log once and stay in local-only mode.
    const moduleName = 'ioredis';
    const mod = await import(moduleName).catch(() => null);
    if (!mod) {
      logger.warn('inflight.redis_module_unavailable', {
        hint: 'REDIS_URL is set but ioredis is not installed — fanout disabled; local-only mode',
      });
      return;
    }
    Redis = (mod as { default: unknown }).default ?? mod;
  } catch (err) {
    logger.warn('inflight.redis_import_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const Ctor = Redis as new (url: string) => RedisClient;
  redisPub = new Ctor(url);
  redisSub = new Ctor(url);
  redisPub.on('error', (err: unknown) => {
    logger.warn('inflight.redis_pub_error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  redisSub.on('error', (err: unknown) => {
    logger.warn('inflight.redis_sub_error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  redisSub.on('message', (_channel: unknown, message: unknown) => {
    if (typeof message !== 'string') return;
    try {
      const parsed = JSON.parse(message) as RedisMessage;
      if (!parsed || parsed.origin === INSTANCE_ID) return;  // skip own messages
      handleIncomingRedisMessage(parsed);
    } catch (err) {
      logger.warn('inflight.redis_message_parse_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  redisSub.subscribe(REDIS_CHANNEL);
  logger.info('inflight.redis_connected', { channel: REDIS_CHANNEL });
}

function handleIncomingRedisMessage(msg: RedisMessage): void {
  const envelope = msg.envelope;
  if (!envelope || !envelope.payload) return;
  const payload = envelope.payload;
  const runtimeKey = envelope.entityId;
  const existing = slots.get(runtimeKey);

  if (msg.kind === 'added') {
    const entry = payload as InFlightEntry;
    const outcome = applyIncomingEvent({
      kind:         'added',
      runtimeKey,
      startedAt:    entry.startedAt,
      stateVersion: 1,
      entry,
      existing,
    });
    if (outcome.kind === 'stale_ignored') {
      logger.debug('inflight.event_stale_ignored', {
        runtimeKey,
        source: 'redis',
        kind:   'added',
      });
      return;
    }
    if (outcome.kind === 'apply_add') {
      // Cap check for Redis-fed adds: if this node is already at capacity, drop
      // the remote event silently rather than evicting a local slot. Unlike the
      // local add() path, we must NOT call evictVictim() here — evictVictim()
      // routes through remove() which publishes back to Redis, and that
      // synthetic `removed` event would reach the origin node, making it think
      // a live call was evicted when it is still running. Dropping the mirror is
      // the safe choice: the remote call is still tracked on the origin instance.
      if (countActive() >= MAX_INFLIGHT_ENTRIES) {
        logger.debug('inflight.redis_add_dropped_at_cap', {
          runtimeKey,
          activeCount: countActive(),
          capacity:    MAX_INFLIGHT_ENTRIES,
        });
        return;
      }
      slots.set(runtimeKey, outcome.slot);
      broadcast(EVENT_ADDED, outcome.envelope);
      emitActiveCount();
    }
    return;
  }

  const removal = payload as InFlightRemoval;
  const outcome = applyIncomingEvent({
    kind:         'removed',
    runtimeKey,
    startedAt:    existing?.entry.startedAt ?? msg.envelope.timestamp,
    stateVersion: 2,
    removal,
    existing,
  });
  if (outcome.kind === 'stale_ignored') {
    logger.debug('inflight.event_stale_ignored', {
      runtimeKey,
      source: 'redis',
      kind:   'removed',
    });
    return;
  }
  if (outcome.kind === 'apply_remove') {
    slots.set(runtimeKey, outcome.slot);
    scheduleSlotPrune(runtimeKey);
    broadcast(EVENT_REMOVED, outcome.envelope);
    emitActiveCount();
  }
}
