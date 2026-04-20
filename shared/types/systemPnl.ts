// ---------------------------------------------------------------------------
// Shared contracts for the System P&L admin page (spec §19).
//
// Imported by both the server (`server/services/systemPnlService.ts`,
// `server/routes/systemPnl.ts`) and the client
// (`client/src/pages/SystemPnlPage.tsx` + components under
// `client/src/components/system-pnl/`).
//
// Conventions:
//   - `*Cents` fields are integer cents. The wire format is scalar integer;
//     the client formats to currency strings at render time.
//   - `null` on revenue / margin / org identity fields marks an "overhead"
//     row per spec §11.5 — the client renders em-dashes. An overhead row
//     satisfies `revenueCents === null` regardless of sourceType.
//   - All date strings are ISO 8601: YYYY-MM for months, YYYY-MM-DD for days.
// ---------------------------------------------------------------------------

// ── Summary (4 KPI cards) ─────────────────────────────────────────────────

export interface PnlSummary {
  period:          string;                   // 'YYYY-MM'
  previousPeriod:  string | null;
  revenue:         KpiValue;
  grossProfit:     KpiValueWithMargin;
  platformOverhead: KpiValueWithPctOfRevenue;
  netProfit:       KpiValueWithMarginPp;
}

export interface KpiValue {
  cents:  number;
  change: KpiChangePct | null;               // null when previousPeriod is null
}

export interface KpiValueWithMargin {
  cents:   number;
  margin:  number;                           // gross profit / revenue, %
  change:  KpiChangePct | null;
}

export interface KpiValueWithPctOfRevenue {
  cents:        number;
  pctOfRevenue: number;                      // overhead / revenue, %
}

export interface KpiValueWithMarginPp {
  cents:  number;
  margin: number;
  change: KpiChangePp | null;                // percentage-point delta
}

export interface KpiChangePct {
  pct:       number;
  direction: 'up' | 'down' | 'flat';
}

export interface KpiChangePp {
  pp:        number;
  direction: 'up' | 'down' | 'flat';
}

// ── Tab rows ──────────────────────────────────────────────────────────────

/** Rendered on the `By Organisation` tab. */
export interface OrgRow {
  organisationId:   string;
  organisationName: string;
  slug:             string | null;
  marginTier:       number;                  // e.g. 1.30, 1.40
  subaccountCount:  number;
  requests:         number;
  revenueCents:     number;
  costCents:        number;
  profitCents:      number;
  marginPct:        number;                  // profitCents / revenueCents
  pctOfRevenue:     number;                  // revenueCents / platform revenue
  trendSparkline:   number[];                // 30 daily normalised values in [0,1]
}

/** Aggregated overhead row rendered below the per-org rows. */
export interface OverheadRow {
  kind:         'overhead';
  label:        string;
  description:  string;
  requests:     number;
  revenueCents: null;
  costCents:    number;
  profitCents:  number;                      // = -costCents
  marginPct:    null;
  pctOfRevenue: number;                      // costCents / platform revenue
}

export interface ByOrganisationResponse {
  orgs:     OrgRow[];
  overhead: OverheadRow;
}

export interface SubacctRow {
  subaccountId:     string;
  subaccountName:   string;
  organisationId:   string;
  organisationName: string;
  marginTier:       number;
  requests:         number;
  revenueCents:     number;
  costCents:        number;
  profitCents:      number;
  marginPct:        number;
  pctOfRevenue:     number;
}

/** Rendered on the `By Source Type` tab — 5 rows, one per distinct sourceType. */
export interface SourceTypeRow {
  sourceType:   'agent_run' | 'process_execution' | 'iee' | 'system' | 'analyzer';
  label:        string;
  description:  string;
  orgsCount:    number;
  requests:     number;
  revenueCents: number | null;               // null for overhead rows (system, analyzer)
  costCents:    number;
  profitCents:  number;                      // revenue - cost, or -cost when null
  marginPct:    number | null;               // null iff revenueCents is null
  pctOfCost:    number;                      // costCents / platform cost
}

export interface ProviderModelRow {
  provider:     string;
  model:        string;
  requests:     number;
  revenueCents: number;
  costCents:    number;
  profitCents:  number;
  marginPct:    number;
  avgLatencyMs: number;
  pctOfCost:    number;
}

// ── Trend chart ────────────────────────────────────────────────────────────

export interface DailyTrendRow {
  day:           string;                     // 'YYYY-MM-DD'
  revenueCents:  number;                     // 0 for days with no activity (not null)
  costCents:     number;                     // includes overhead
  overheadCents: number;                     // sum of sourceType in {system, analyzer}
}

// ── Top calls list + detail drawer ────────────────────────────────────────

export interface TopCallRow {
  id:               string;                  // llm_requests.id
  createdAt:        string;                  // ISO 8601
  organisationName: string | null;           // null for overhead rows
  subaccountName:   string | null;
  marginTier:       number | null;
  sourceType:       string;
  sourceLabel:      string;
  provider:         string;
  model:            string;
  tokensIn:         number;
  tokensOut:        number;
  revenueCents:     number | null;
  costCents:        number;
  profitCents:      number;                  // -costCents when revenueCents is null
  status:           string;
}

export interface CallDetail extends TopCallRow {
  idempotencyKey:          string;
  providerRequestId:       string | null;
  organisationId:          string | null;
  subaccountId:            string | null;
  runId:                   string | null;
  sourceId:                string | null;
  attemptNumber:           number;
  fallbackChain:           unknown;          // parsed JSON or null
  errorMessage:            string | null;
  parseFailureRawExcerpt:  string | null;
  abortReason:             string | null;
  cachedPromptTokens:      number;
  providerLatencyMs:       number | null;
  routerOverheadMs:        number | null;
}

// ── HTTP envelope ──────────────────────────────────────────────────────────

export interface PnlResponseMeta {
  period:             string;                // 'YYYY-MM' or daily-window tag
  generatedAt:        string;                // ISO 8601
}

export interface PnlResponse<TData> {
  data: TData;
  meta: PnlResponseMeta;
}

// ── LLM in-flight tracker (spec tasks/llm-inflight-realtime-tracker-spec.md) ──
//
// Real-time admin-only view of LLM calls currently dispatched but not yet
// resolved. Read by `client/src/components/system-pnl/PnlInFlightTable.tsx`
// and `client/src/pages/SystemPnlPage.tsx`; produced by
// `server/services/llmInflightRegistry.ts`. The registry is keyed by
// `runtimeKey = ${idempotencyKey}:${attempt}:${startedAt}` so multi-attempt
// retries and crash-restarts never collide.

export type InFlightSourceType =
  | 'agent_run'
  | 'process_execution'
  | 'system'
  | 'iee'
  | 'analyzer';

export type InFlightTerminalStatus =
  | 'success'
  | 'error'
  | 'timeout'
  | 'aborted_by_caller'
  | 'client_disconnected'
  | 'parse_failure'
  | 'provider_unavailable'
  | 'provider_not_configured'
  | 'partial'
  | 'swept_stale'
  | 'evicted_overflow';

// `sweepReason` exists only when `terminalStatus === 'swept_stale'`. v1
// ships the single reason — the field leaves room for future sweep causes
// without a status-enum migration (spec §4.5).
export type InFlightSweepReason = 'deadline_exceeded';

export interface InFlightEvictionContext {
  activeCount: number;
  capacity:    number;
}

export interface InFlightEntry {
  runtimeKey:       string;                  // `${idempotencyKey}:${attempt}:${startedAt}`
  idempotencyKey:   string;
  attempt:          number;                  // 1-indexed
  startedAt:        string;                  // ISO 8601 UTC — monotonicity anchor
  stateVersion:     1;                       // 1 = active on add
  deadlineAt:       string;                  // startedAt + timeoutMs + deadlineBufferMs
  deadlineBufferMs: number;                  // buffer past timeoutMs before sweep fires
  label:            string;                  // `${provider}/${model}`
  provider:         string;
  model:            string;
  sourceType:       InFlightSourceType;
  sourceId:         string | null;
  featureTag:       string;                  // kebab-case
  organisationId:   string | null;
  subaccountId:     string | null;
  runId:            string | null;
  executionId:      string | null;
  ieeRunId:         string | null;
  callSite:         'app' | 'worker';        // display-only; no server branches on it
  timeoutMs:        number;                  // the cap this call is running under
}

export interface InFlightRemoval {
  runtimeKey:        string;
  idempotencyKey:    string;
  attempt:           number;
  stateVersion:      2;                      // terminal transition — always 2
  terminalStatus:    InFlightTerminalStatus;
  sweepReason:       InFlightSweepReason | null;  // non-null iff terminalStatus==='swept_stale'
  evictionContext:   InFlightEvictionContext | null;  // non-null iff terminalStatus==='evicted_overflow'
  completedAt:       string;
  durationMs:        number;
  ledgerRowId:       string | null;          // null when terminalStatus produces no ledger insert
  ledgerCommittedAt: string | null;          // ISO 8601 — filled iff ledger upsert committed
}

// Socket / Redis event envelope. Carries `eventId = ${runtimeKey}:${type}`
// for client-side dedup (spec §4.4).
export interface InFlightEventEnvelope<TPayload> {
  eventId:   string;
  type:      'added' | 'removed';
  entityId:  string;                         // runtimeKey
  timestamp: string;                         // ISO 8601
  payload:   TPayload;
}

export interface InFlightSnapshotResponse {
  entries:     InFlightEntry[];
  generatedAt: string;
  capped:      boolean;
}

// Active-count gauge payload (spec §4.4). Emitted on every add/remove via
// `createEvent('llm.inflight.active_count', ...)` so alerting can pick up
// stuck workers or provider-specific hangs without digging logs.
export interface InFlightActiveCountPayload {
  activeCount: number;
  byCallSite:  { app: number; worker: number };
  byProvider:  Record<string, number>;
}
