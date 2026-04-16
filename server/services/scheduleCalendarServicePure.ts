// ---------------------------------------------------------------------------
// Schedule Calendar — pure projection layer
// ---------------------------------------------------------------------------
//
// Stateless, deterministic projection of future scheduled runs across four
// sources: heartbeat agents, cron agents, recurring playbooks, and scheduled
// tasks. Consumed by `scheduleCalendarService.ts` (the stateful wrapper) to
// render the Scheduled Runs Calendar.
//
// Invariants (see `docs/routines-response-dev-spec.md` §3.9):
//
//   - Deterministic: same inputs → identical outputs. No `Date.now()`, no I/O.
//   - Projection–execution parity: must stay bit-exact with what the scheduler
//     actually dispatches. The cron path uses cron-parser (same library
//     pg-boss uses internally). The RRULE path uses rrule.js with the same
//     wall-clock-in-timezone conversion as `scheduledTaskService.ts`. The
//     heartbeat path is UTC-anchored absolute-interval math, matching the
//     contract the dispatcher (when wired) must conform to.
//   - Memory safety: per-source caps + sort-then-truncate at the stateful
//     layer. This file never materialises more than a per-source bound.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OccurrenceSource = 'heartbeat' | 'cron' | 'playbook' | 'scheduled_task';

export type ScopeTag = 'system' | 'org' | 'subaccount';

export interface ScheduleOccurrence {
  /**
   * Stable deterministic hash: sha256(source + ':' + sourceId + ':' + scheduledAt)[0..31]
   * — 128-bit hex prefix. Not globally unique across all time but collision-free
   * within any realistic response window (birthday bound ~2^64 before collision
   * in a 10k-item set).
   */
  occurrenceId: string;
  scheduledAt: string; // ISO — always UTC
  source: OccurrenceSource;
  sourceId: string;
  sourceName: string;
  subaccountId: string;
  subaccountName: string;
  agentId?: string;
  agentName?: string;
  runType: 'scheduled';
  estimatedTokens: number | null;
  estimatedCost: number | null;
  scopeTag: ScopeTag;
}

// Shared shape: everything needed to project except the scheduling-source-specific fields.
export interface OccurrenceBase {
  subaccountId: string;
  subaccountName: string;
  agentId?: string;
  agentName?: string;
  scopeTag: ScopeTag;
}

/**
 * Deterministic source ordering for stable sort tie-breaking within the same
 * `scheduledAt` timestamp. Never inline these integers — always reference this
 * constant so the ordering is single-sourced.
 */
export const SOURCE_PRIORITY = {
  heartbeat: 1,
  cron: 2,
  playbook: 3,
  scheduled_task: 4,
} as const satisfies Record<OccurrenceSource, number>;

/**
 * Per-source projection cap. The stateful layer further enforces a global 10k
 * cap (see spec §3.3). Per-source caps prevent one pathological heartbeat
 * agent from dominating the response while starving other sources.
 */
export const MAX_PROJECTED_PER_SOURCE = 5_000;

/**
 * Global cap surfaced to the stateful layer. Must match spec §3.3.
 */
export const MAX_OCCURRENCES_PER_RESPONSE = 10_000;

/**
 * Beyond this threshold the stateful layer reports estimatedTotalCount=null
 * rather than enumerating everything. Counting >50k is itself expensive.
 */
export const TOTAL_COUNT_ESTIMATE_CEILING = 50_000;

// ---------------------------------------------------------------------------
// Heartbeat projection
// ---------------------------------------------------------------------------
//
// Contract (spec §3.9): "Follows absolute interval time (UTC-anchored). DST
// shifts do not change when the next occurrence fires — the interval is
// constant in UTC."
//
// Anchor: epoch 1970-01-01T00:00:00Z. The next fire is the smallest
// `k * intervalMs + offsetMs` strictly greater than `afterMs`, where k is an
// integer >= 0. This is UTC-anchored, DST-invariant by construction.
//
// ⚠️ Any future heartbeat dispatcher must consume `computeNextHeartbeatAt`
// from this file so the projection and dispatcher stay bit-exact.
// ---------------------------------------------------------------------------

export interface HeartbeatInput extends OccurrenceBase {
  /** Effective interval in hours (link override or agent default). Must be > 0. */
  intervalHours: number;
  /** Additional offset in hours (0-23). Applied as a phase shift from UTC midnight. */
  offsetHours: number;
  /** Additional offset in minutes (0-59). Applied as a phase shift from UTC midnight. */
  offsetMinutes: number;
  sourceId: string;
  sourceName: string;
}

/**
 * Returns the next heartbeat fire time strictly after `afterMs`, anchored to
 * UTC epoch. Pure function — no `Date.now()`, no locale, no I/O.
 */
export function computeNextHeartbeatAt(
  afterMs: number,
  intervalHours: number,
  offsetHours: number,
  offsetMinutes: number
): number {
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    throw new Error(`computeNextHeartbeatAt: intervalHours must be > 0 (got ${intervalHours})`);
  }
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const offsetMs = (offsetHours * 60 + offsetMinutes) * 60 * 1000;
  // Next k such that k*interval + offset > afterMs.
  // Solve for k: k > (afterMs - offsetMs) / intervalMs.
  const k = Math.floor((afterMs - offsetMs) / intervalMs) + 1;
  return k * intervalMs + offsetMs;
}

export function projectHeartbeatOccurrences(
  input: HeartbeatInput,
  windowStartMs: number,
  windowEndMs: number
): Array<{ scheduledAt: Date; base: OccurrenceBase; sourceId: string; sourceName: string }> {
  const out: Array<{ scheduledAt: Date; base: OccurrenceBase; sourceId: string; sourceName: string }> = [];
  if (windowStartMs >= windowEndMs) return out;
  let nextMs = computeNextHeartbeatAt(
    windowStartMs - 1,
    input.intervalHours,
    input.offsetHours,
    input.offsetMinutes
  );
  const intervalMs = input.intervalHours * 60 * 60 * 1000;
  while (nextMs < windowEndMs && out.length < MAX_PROJECTED_PER_SOURCE) {
    if (nextMs >= windowStartMs) {
      out.push({
        scheduledAt: new Date(nextMs),
        base: {
          subaccountId: input.subaccountId,
          subaccountName: input.subaccountName,
          agentId: input.agentId,
          agentName: input.agentName,
          scopeTag: input.scopeTag,
        },
        sourceId: input.sourceId,
        sourceName: input.sourceName,
      });
    }
    nextMs += intervalMs;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cron projection
// ---------------------------------------------------------------------------
//
// Uses cron-parser — the same library pg-boss uses internally. The timezone
// string is passed straight through so DST handling matches the dispatcher.
//
// Spec §3.9 cron DST rule: wall-clock semantics. When DST moves the clock
// forward, the skipped hour yields no occurrence. When DST moves it back, the
// repeated hour fires once. cron-parser implements this natively.
// ---------------------------------------------------------------------------

// We import cron-parser lazily (ESM interop with CJS package; matches the
// rrule dynamic-import pattern in scheduledTaskService.ts).
async function getCronParser(): Promise<{
  parseExpression: (expr: string, options: { tz?: string; currentDate?: Date; endDate?: Date }) => {
    hasNext(): boolean;
    next(): { toDate(): Date };
  };
}> {
  const mod = await import('cron-parser');
  // cron-parser 4.x exports parseExpression on both default and named.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).default ?? (mod as any);
}

export interface CronInput extends OccurrenceBase {
  cronExpression: string;
  cronTimezone: string;
  sourceId: string;
  sourceName: string;
}

export async function projectCronOccurrences(
  input: CronInput,
  windowStartMs: number,
  windowEndMs: number
): Promise<Array<{ scheduledAt: Date; base: OccurrenceBase; sourceId: string; sourceName: string }>> {
  const out: Array<{ scheduledAt: Date; base: OccurrenceBase; sourceId: string; sourceName: string }> = [];
  if (windowStartMs >= windowEndMs) return out;
  const { parseExpression } = await getCronParser();
  let iter: ReturnType<typeof parseExpression>;
  try {
    iter = parseExpression(input.cronExpression, {
      tz: input.cronTimezone || 'UTC',
      currentDate: new Date(windowStartMs - 1),
      endDate: new Date(windowEndMs),
    });
  } catch {
    // Malformed cron — caller already validated, but belt-and-braces.
    return out;
  }
  while (iter.hasNext() && out.length < MAX_PROJECTED_PER_SOURCE) {
    const next = iter.next().toDate();
    if (next.getTime() >= windowEndMs) break;
    out.push({
      scheduledAt: next,
      base: {
        subaccountId: input.subaccountId,
        subaccountName: input.subaccountName,
        agentId: input.agentId,
        agentName: input.agentName,
        scopeTag: input.scopeTag,
      },
      sourceId: input.sourceId,
      sourceName: input.sourceName,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// RRULE projection (shared between playbook and scheduled_task sources)
// ---------------------------------------------------------------------------
//
// Matches the wall-clock-in-timezone conversion used by `scheduledTaskService`.
// The `scheduleTime` (HH:MM) is applied in the target IANA timezone via the
// Intl-based offset-detection trick to stay correct across DST boundaries.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRRule(): Promise<any> {
  const mod = await import('rrule');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).RRule ?? (mod as any).default?.RRule ?? (mod as any);
}

/**
 * Convert a wall-clock (y, m-1-based-as-1-12, d, h, mi) in an IANA tz to UTC.
 * Replicates the technique in `scheduledTaskService.ts:33-53` so the calendar
 * produces identical timestamps to what the scheduler would fire.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(naiveUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const projected = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  const offset = projected - naiveUtc;
  return new Date(naiveUtc - offset);
}

export interface RRuleInput extends OccurrenceBase {
  rrule: string;
  timezone: string;
  scheduleTime: string; // HH:MM 24hr
  source: 'playbook' | 'scheduled_task';
  sourceId: string;
  sourceName: string;
}

export async function projectRRuleOccurrences(
  input: RRuleInput,
  windowStartMs: number,
  windowEndMs: number
): Promise<Array<{ scheduledAt: Date; base: OccurrenceBase; sourceId: string; sourceName: string }>> {
  const out: Array<{ scheduledAt: Date; base: OccurrenceBase; sourceId: string; sourceName: string }> = [];
  if (windowStartMs >= windowEndMs) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rule: any;
  try {
    const RRule = await getRRule();
    rule = RRule.fromString(input.rrule);
  } catch {
    return out;
  }
  const [hoursStr, minutesStr] = input.scheduleTime.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return out;

  // RRule.between() with a 1-year-bound sweep is expensive for high-frequency
  // rules; we'll page through with after() instead, re-applying scheduleTime
  // to each date candidate. Stop when we pass the window end or hit the cap.
  let cursor = new Date(windowStartMs - 1);
  while (out.length < MAX_PROJECTED_PER_SOURCE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next: Date | null = rule.after(cursor, false);
    if (!next) break;
    // next() returns a Date whose UTC components encode the nominal rule date.
    // Apply scheduleTime in the configured timezone.
    const utc = zonedWallClockToUtc(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      hours,
      minutes,
      input.timezone || 'UTC'
    );
    if (utc.getTime() >= windowEndMs) break;
    if (utc.getTime() >= windowStartMs) {
      out.push({
        scheduledAt: utc,
        base: {
          subaccountId: input.subaccountId,
          subaccountName: input.subaccountName,
          agentId: input.agentId,
          agentName: input.agentName,
          scopeTag: input.scopeTag,
        },
        sourceId: input.sourceId,
        sourceName: input.sourceName,
      });
    }
    cursor = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occurrence ID hashing
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

/**
 * Stable deterministic occurrence hash. 128-bit hex prefix — collision-free in
 * any realistic response set.
 */
export function computeOccurrenceId(
  source: OccurrenceSource,
  sourceId: string,
  scheduledAtISO: string
): string {
  return createHash('sha256')
    .update(`${source}:${sourceId}:${scheduledAtISO}`)
    .digest('hex')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Sort & truncate
// ---------------------------------------------------------------------------

/**
 * Stable multi-key sort applied to the merged occurrence list before
 * truncation. See spec §3.9.
 *
 *   1. scheduledAt asc
 *   2. SOURCE_PRIORITY asc
 *   3. sourceId lex asc
 */
export function sortOccurrences(items: ScheduleOccurrence[]): ScheduleOccurrence[] {
  return [...items].sort((a, b) => {
    const tdiff = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    if (tdiff !== 0) return tdiff;
    const pdiff = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
    if (pdiff !== 0) return pdiff;
    return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
  });
}

export interface TotalsBlock {
  count: number;
  estimatedTokens: number;
  estimatedCost: number;
}

export function computeTotals(items: ScheduleOccurrence[]): TotalsBlock {
  let tokens = 0;
  let cost = 0;
  for (const o of items) {
    if (typeof o.estimatedTokens === 'number') tokens += o.estimatedTokens;
    if (typeof o.estimatedCost === 'number') cost += o.estimatedCost;
  }
  return { count: items.length, estimatedTokens: tokens, estimatedCost: cost };
}

// ---------------------------------------------------------------------------
// Cost estimation rules (spec §3.9)
// ---------------------------------------------------------------------------

export interface RunSample {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Estimate tokens-per-run from recent non-test qualifying runs.
 *
 *   - < 3 samples → null (insufficient history)
 *   - otherwise:  average of min(10, N) most-recent samples
 */
export function estimateTokensPerRun(samples: RunSample[]): number | null {
  if (samples.length < 3) return null;
  const window = samples.slice(0, Math.min(10, samples.length));
  const total = window.reduce((acc, s) => acc + s.promptTokens + s.completionTokens, 0);
  return Math.round(total / window.length);
}

/**
 * Request-window validation — spec §3.3. 30-day max, start < end, ISO in/out.
 * Returns either a valid window or an error discriminator; caller maps it to
 * a 400 response.
 */
export const MAX_WINDOW_DAYS = 30;

export function validateWindow(
  startISO: string,
  endISO: string
):
  | { ok: true; startMs: number; endMs: number }
  | { ok: false; reason: 'invalid_iso' | 'start_not_before_end' | 'window_too_large' } {
  const startMs = Date.parse(startISO);
  const endMs = Date.parse(endISO);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { ok: false, reason: 'invalid_iso' };
  }
  if (startMs >= endMs) return { ok: false, reason: 'start_not_before_end' };
  const span = endMs - startMs;
  if (span > MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: 'window_too_large' };
  }
  return { ok: true, startMs, endMs };
}
