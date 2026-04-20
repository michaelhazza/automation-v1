// ---------------------------------------------------------------------------
// Pure logic for the LLM in-flight registry — spec
// tasks/llm-inflight-realtime-tracker-spec.md §6.
//
// Per repo convention (docs/testing-conventions.md), *Pure.ts files must not
// import from db, env, service layer, Redis, or Socket.IO. Everything below
// is Web-standard primitives plus type definitions — exercisable in tests
// without booting the env-dependent registry module.
//
// What lives here:
//   - InFlightEntry / InFlightRemoval contract types (re-exported from
//     shared/types/systemPnl)
//   - runtimeKey / deadlineAt / eventId derivation
//   - applyAdd / applyRemove / applyIncomingEvent — state-machine transitions
//     returning an outcome tag + (when applicable) the next map value + emit
//     payload. The impure wrapper does the Map mutation + the emit.
//   - selectEvictionVictim — LRU overflow selection (oldest startedAt wins)
//   - buildSnapshot — 500-cap stable-sorted snapshot
//   - terminalStatusExpectsLedgerRow — ledger-reconciliation mapping
//   - buildActiveCountPayload — gauge payload with per-callSite + per-provider
//     breakdown
//
// The impure surface (server/services/llmInflightRegistry.ts) calls these
// with its Map + Redis subscriber + Socket.IO emitter + sweep timer.
// ---------------------------------------------------------------------------

import type {
  InFlightEntry,
  InFlightRemoval,
  InFlightEventEnvelope,
  InFlightTerminalStatus,
  InFlightSweepReason,
  InFlightEvictionContext,
  InFlightActiveCountPayload,
} from '../../shared/types/systemPnl.js';

// Internal slot shape — tracked inside the per-process Map. Kept distinct
// from the over-the-wire InFlightEntry so the Map can carry the entry's
// latest stateVersion (bumped to 2 on remove) without mutating the frozen
// entry shape that was emitted on add.
export type EntryState = 'active' | 'removed';

export interface RegistrySlot {
  entry: InFlightEntry;
  state: EntryState;
  stateVersion: 1 | 2;
}

// Outcome tags returned from applyAdd / applyRemove / applyIncomingEvent.
// The impure wrapper inspects the tag to decide whether to broadcast.
export type AddOutcome =
  | { kind: 'added'; slot: RegistrySlot; envelope: InFlightEventEnvelope<InFlightEntry> }
  | { kind: 'noop_already_exists'; reason: 'add_noop_already_exists' };

export type RemoveOutcome =
  | { kind: 'removed'; slot: RegistrySlot; envelope: InFlightEventEnvelope<InFlightRemoval> }
  | { kind: 'noop_already_removed'; reason: 'remove_noop_already_removed' }
  | { kind: 'noop_missing_key'; reason: 'remove_noop_missing_key' };

export type IncomingEventOutcome =
  | { kind: 'apply_add'; slot: RegistrySlot; envelope: InFlightEventEnvelope<InFlightEntry> }
  | { kind: 'apply_remove'; slot: RegistrySlot; envelope: InFlightEventEnvelope<InFlightRemoval> }
  | { kind: 'stale_ignored'; reason: 'event_stale_ignored' };

// ── Runtime-key derivation ────────────────────────────────────────────────

/**
 * `${idempotencyKey}:${attempt}:${startedAt}` — unique across crash-restarts.
 *
 * Spec §4.2:
 *   - `attempt` matches the counter already tracked by `attemptNumber` in
 *     the ledger.
 *   - `startedAt` closes the crash-restart collision case — if a process
 *     crashes mid-retry and a restarted loop resets `attempt` from 1, we
 *     would otherwise collide with a prior in-memory entry on another
 *     instance. `startedAt` guarantees uniqueness without relying on a
 *     monotonic `attempt` across crashes.
 */
export function buildRuntimeKey(params: {
  idempotencyKey: string;
  attempt: number;
  startedAt: string;
}): string {
  return `${params.idempotencyKey}:${params.attempt}:${params.startedAt}`;
}

/**
 * `${runtimeKey}:${type}` — dedup anchor on the wire. Spec §4.4.
 */
export function buildEventId(runtimeKey: string, type: 'added' | 'removed'): string {
  return `${runtimeKey}:${type}`;
}

// ── Deadline calc ─────────────────────────────────────────────────────────

/**
 * `startedAt + timeoutMs + deadlineBufferMs`. Spec §4.5 — capturing the
 * deadline at add-time makes the sweep robust to PROVIDER_CALL_TIMEOUT_MS
 * changes mid-run and to small clock drift across instances.
 */
export function buildDeadlineAt(params: {
  startedAt: string;
  timeoutMs: number;
  deadlineBufferMs: number;
}): string {
  const startedMs = Date.parse(params.startedAt);
  return new Date(startedMs + params.timeoutMs + params.deadlineBufferMs).toISOString();
}

// ── Entry builder ─────────────────────────────────────────────────────────

export interface BuildEntryInput {
  idempotencyKey:   string;
  attempt:          number;
  startedAt:        string;
  label:            string;
  provider:         string;
  model:            string;
  sourceType:       InFlightEntry['sourceType'];
  sourceId:         string | null;
  featureTag:       string;
  organisationId:   string | null;
  subaccountId:     string | null;
  runId:            string | null;
  executionId:      string | null;
  ieeRunId:         string | null;
  callSite:         'app' | 'worker';
  timeoutMs:        number;
  deadlineBufferMs: number;
}

export function buildEntry(input: BuildEntryInput): InFlightEntry {
  return {
    runtimeKey: buildRuntimeKey({
      idempotencyKey: input.idempotencyKey,
      attempt:        input.attempt,
      startedAt:      input.startedAt,
    }),
    idempotencyKey:   input.idempotencyKey,
    attempt:          input.attempt,
    startedAt:        input.startedAt,
    stateVersion:     1,
    deadlineAt:       buildDeadlineAt({
      startedAt:        input.startedAt,
      timeoutMs:        input.timeoutMs,
      deadlineBufferMs: input.deadlineBufferMs,
    }),
    deadlineBufferMs: input.deadlineBufferMs,
    label:            input.label,
    provider:         input.provider,
    model:            input.model,
    sourceType:       input.sourceType,
    sourceId:         input.sourceId,
    featureTag:       input.featureTag,
    organisationId:   input.organisationId,
    subaccountId:     input.subaccountId,
    runId:            input.runId,
    executionId:      input.executionId,
    ieeRunId:         input.ieeRunId,
    callSite:         input.callSite,
    timeoutMs:        input.timeoutMs,
  };
}

// ── Terminal-status → ledger-expectation mapping ──────────────────────────

/**
 * Which terminal statuses are expected to produce a ledger row. Used by
 * the client to decide when to fetch the ledger row for details — and by
 * tests to pin the router-side invariant.
 *
 * Spec §5 + §10:
 *   - success / error / timeout / aborted_by_caller / client_disconnected
 *     / parse_failure / provider_unavailable / provider_not_configured
 *     / partial → expect ledger row.
 *   - swept_stale / evicted_overflow → no ledger insert by this code path.
 */
export function terminalStatusExpectsLedgerRow(status: InFlightTerminalStatus): boolean {
  switch (status) {
    case 'success':
    case 'error':
    case 'timeout':
    case 'aborted_by_caller':
    case 'client_disconnected':
    case 'parse_failure':
    case 'provider_unavailable':
    case 'provider_not_configured':
    case 'partial':
      return true;
    case 'swept_stale':
    case 'evicted_overflow':
      return false;
  }
}

// ── State-machine transitions ─────────────────────────────────────────────

/**
 * Apply `add` — no-op if a slot for this runtimeKey already exists.
 * Spec §4.3. The impure wrapper consults `existing` from its Map.
 */
export function applyAdd(params: {
  entry: InFlightEntry;
  existing: RegistrySlot | undefined;
}): AddOutcome {
  if (params.existing) {
    return { kind: 'noop_already_exists', reason: 'add_noop_already_exists' };
  }
  const slot: RegistrySlot = { entry: params.entry, state: 'active', stateVersion: 1 };
  const envelope: InFlightEventEnvelope<InFlightEntry> = {
    eventId:   buildEventId(params.entry.runtimeKey, 'added'),
    type:      'added',
    entityId:  params.entry.runtimeKey,
    timestamp: new Date().toISOString(),
    payload:   params.entry,
  };
  return { kind: 'added', slot, envelope };
}

export interface ApplyRemoveInput {
  runtimeKey:        string;
  terminalStatus:    InFlightTerminalStatus;
  completedAt:       string;
  ledgerRowId:       string | null;
  ledgerCommittedAt: string | null;
  sweepReason:       InFlightSweepReason | null;
  evictionContext:   InFlightEvictionContext | null;
  existing:          RegistrySlot | undefined;
}

/**
 * Apply `remove` — no-op if the slot is already 'removed' or missing.
 * On success, the slot transitions to state='removed', stateVersion=2.
 * Spec §4.3.
 */
export function applyRemove(params: ApplyRemoveInput): RemoveOutcome {
  if (!params.existing) {
    return { kind: 'noop_missing_key', reason: 'remove_noop_missing_key' };
  }
  if (params.existing.state === 'removed') {
    return { kind: 'noop_already_removed', reason: 'remove_noop_already_removed' };
  }
  const completedMs = Date.parse(params.completedAt);
  const startedMs   = Date.parse(params.existing.entry.startedAt);
  const durationMs  = Math.max(0, completedMs - startedMs);

  const removal: InFlightRemoval = {
    runtimeKey:        params.runtimeKey,
    idempotencyKey:    params.existing.entry.idempotencyKey,
    attempt:           params.existing.entry.attempt,
    stateVersion:      2,
    terminalStatus:    params.terminalStatus,
    sweepReason:       params.sweepReason,
    evictionContext:   params.evictionContext,
    completedAt:       params.completedAt,
    durationMs,
    ledgerRowId:       params.ledgerRowId,
    ledgerCommittedAt: params.ledgerCommittedAt,
  };
  const nextSlot: RegistrySlot = {
    entry:        params.existing.entry,
    state:        'removed',
    stateVersion: 2,
  };
  const envelope: InFlightEventEnvelope<InFlightRemoval> = {
    eventId:   buildEventId(params.runtimeKey, 'removed'),
    type:      'removed',
    entityId:  params.runtimeKey,
    timestamp: new Date().toISOString(),
    payload:   removal,
  };
  return { kind: 'removed', slot: nextSlot, envelope };
}

// ── Incoming Redis event — monotonic stateVersion guard ───────────────────

/**
 * Merge an incoming Redis event through the same state-machine rules as
 * local add/remove, with the additional monotonic guard from spec §4.3:
 *
 *   - Ignored if `incoming.startedAt < existing.startedAt` (stale runtimeKey
 *     we've already rotated through).
 *   - Ignored if `incoming.startedAt === existing.startedAt &&
 *     incoming.stateVersion < existing.stateVersion` (same-timestamp
 *     reorder: a late `add` arriving after `remove` has already won).
 *   - Otherwise apply the event via applyAdd / applyRemove.
 *
 * The existence of `existing` is queried from the Map by the impure wrapper.
 */
export interface IncomingEventInput {
  kind:          'added' | 'removed';
  runtimeKey:    string;
  startedAt:     string;
  stateVersion:  1 | 2;
  /** For kind='added' — the full entry payload from Redis. */
  entry?:        InFlightEntry;
  /** For kind='removed' — the full removal payload from Redis. */
  removal?:      InFlightRemoval;
  /** Current slot from the local Map (undefined if absent). */
  existing:      RegistrySlot | undefined;
}

export function applyIncomingEvent(input: IncomingEventInput): IncomingEventOutcome {
  if (input.existing) {
    const existingStarted = Date.parse(input.existing.entry.startedAt);
    const incomingStarted = Date.parse(input.startedAt);
    if (incomingStarted < existingStarted) {
      return { kind: 'stale_ignored', reason: 'event_stale_ignored' };
    }
    if (incomingStarted === existingStarted && input.stateVersion < input.existing.stateVersion) {
      return { kind: 'stale_ignored', reason: 'event_stale_ignored' };
    }
  }

  if (input.kind === 'added') {
    if (!input.entry) {
      return { kind: 'stale_ignored', reason: 'event_stale_ignored' };
    }
    // If the slot exists and is already 'active' at the same stateVersion,
    // this is a Redis double-delivery — treated as stale-ignored (not a
    // fresh add). The monotonic guard above already rejects v1-after-v2.
    if (input.existing && input.existing.state === 'active') {
      return { kind: 'stale_ignored', reason: 'event_stale_ignored' };
    }
    const slot: RegistrySlot = { entry: input.entry, state: 'active', stateVersion: 1 };
    const envelope: InFlightEventEnvelope<InFlightEntry> = {
      eventId:   buildEventId(input.runtimeKey, 'added'),
      type:      'added',
      entityId:  input.runtimeKey,
      timestamp: new Date().toISOString(),
      payload:   input.entry,
    };
    return { kind: 'apply_add', slot, envelope };
  }

  // kind === 'removed'
  if (!input.removal) {
    return { kind: 'stale_ignored', reason: 'event_stale_ignored' };
  }
  // If the local slot doesn't exist, still accept the removal so downstream
  // clients (e.g. an admin that joined mid-flight) see the terminal event —
  // but synthesize a minimal slot from the removal so our Map reflects the
  // remote state. On add-not-yet-seen, the existing slot is absent — create
  // it as 'removed' so a subsequent stale add is properly rejected.
  const syntheticEntry: InFlightEntry = input.existing?.entry ?? {
    runtimeKey:       input.runtimeKey,
    idempotencyKey:   input.removal.idempotencyKey,
    attempt:          input.removal.attempt,
    startedAt:        input.startedAt,
    stateVersion:     1,
    // We don't have the full entry on a remove-only event — leave
    // placeholder fields that downstream consumers tolerate. The UI never
    // fetches the entry's body from a removal event.
    deadlineAt:       input.startedAt,
    deadlineBufferMs: 0,
    label:            '',
    provider:         '',
    model:            '',
    sourceType:       'system',
    sourceId:         null,
    featureTag:       'unknown',
    organisationId:   null,
    subaccountId:     null,
    runId:            null,
    executionId:      null,
    ieeRunId:         null,
    callSite:         'app',
    timeoutMs:        0,
  };
  const nextSlot: RegistrySlot = {
    entry:        syntheticEntry,
    state:        'removed',
    stateVersion: 2,
  };
  const envelope: InFlightEventEnvelope<InFlightRemoval> = {
    eventId:   buildEventId(input.runtimeKey, 'removed'),
    type:      'removed',
    entityId:  input.runtimeKey,
    timestamp: new Date().toISOString(),
    payload:   input.removal,
  };
  return { kind: 'apply_remove', slot: nextSlot, envelope };
}

// ── LRU overflow selection ────────────────────────────────────────────────

/**
 * Pick the oldest entry (by startedAt ASC, runtimeKey ASC as tiebreaker)
 * when the map is at `MAX_INFLIGHT_ENTRIES`. Only 'active' slots are
 * eligible — 'removed' slots should have been pruned by the caller already,
 * but we skip them here defensively.
 *
 * Spec §4.4 — LRU overflow. The evicted entry produces an InFlightRemoval
 * with `terminalStatus: 'evicted_overflow'` carrying `evictionContext`.
 */
export function selectEvictionVictim(
  slots: Iterable<RegistrySlot>,
): RegistrySlot | null {
  let oldest: RegistrySlot | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    if (slot.state !== 'active') continue;
    const ms = Date.parse(slot.entry.startedAt);
    if (ms < oldestMs || (ms === oldestMs && oldest !== null && slot.entry.runtimeKey < oldest.entry.runtimeKey)) {
      oldest = slot;
      oldestMs = ms;
    }
  }
  return oldest;
}

// ── Snapshot sort + cap ───────────────────────────────────────────────────

/**
 * Snapshot comparator — `startedAt DESC, runtimeKey DESC`.
 * Spec §5 + §10: secondary sort pins stable ordering under load when
 * multiple entries share a millisecond startedAt; without it, two snapshot
 * fetches in the same second can return identical rows in different orders
 * and the UI flickers.
 */
export function compareForSnapshot(a: InFlightEntry, b: InFlightEntry): number {
  if (a.startedAt > b.startedAt) return -1;
  if (a.startedAt < b.startedAt) return 1;
  if (a.runtimeKey > b.runtimeKey) return -1;
  if (a.runtimeKey < b.runtimeKey) return 1;
  return 0;
}

export interface SnapshotOutput {
  entries:     InFlightEntry[];
  generatedAt: string;
  capped:      boolean;
}

/**
 * Build a snapshot from the set of active slots. Sorts by the comparator
 * above, caps at `limit`, and reports `capped: true` when the live count
 * exceeded `limit`.
 *
 * `limit` is clamped to [1, hardCap] silently per spec §5.
 */
export function buildSnapshot(params: {
  slots:       Iterable<RegistrySlot>;
  limit:       number;
  hardCap:     number;
  generatedAt: string;
}): SnapshotOutput {
  const effectiveLimit = Math.max(1, Math.min(params.limit, params.hardCap));
  const active: InFlightEntry[] = [];
  for (const slot of params.slots) {
    if (slot.state === 'active') active.push(slot.entry);
  }
  active.sort(compareForSnapshot);
  const capped = active.length > effectiveLimit;
  return {
    entries:     capped ? active.slice(0, effectiveLimit) : active,
    generatedAt: params.generatedAt,
    capped,
  };
}

// ── Active-count gauge payload ────────────────────────────────────────────

/**
 * Spec §4.4 — gauge tagged by `callSite` and `provider` so a stuck-worker
 * spike or provider-specific hang is legible without digging logs.
 */
export function buildActiveCountPayload(
  slots: Iterable<RegistrySlot>,
): InFlightActiveCountPayload {
  let activeCount = 0;
  const byCallSite: Record<'app' | 'worker', number> = { app: 0, worker: 0 };
  const byProvider: Record<string, number> = {};
  for (const slot of slots) {
    if (slot.state !== 'active') continue;
    activeCount++;
    byCallSite[slot.entry.callSite]++;
    byProvider[slot.entry.provider] = (byProvider[slot.entry.provider] ?? 0) + 1;
  }
  return { activeCount, byCallSite, byProvider };
}

// ── Sweep selection ───────────────────────────────────────────────────────

/**
 * Spec §4.5 — deadline-based sweep. Returns the set of slots whose deadline
 * has passed. Caller removes each with `terminalStatus: 'swept_stale'` +
 * `sweepReason: 'deadline_exceeded'`.
 */
export function selectStaleEntries(params: {
  slots: Iterable<RegistrySlot>;
  nowMs: number;
}): RegistrySlot[] {
  const stale: RegistrySlot[] = [];
  for (const slot of params.slots) {
    if (slot.state !== 'active') continue;
    if (params.nowMs > Date.parse(slot.entry.deadlineAt)) {
      stale.push(slot);
    }
  }
  return stale;
}
