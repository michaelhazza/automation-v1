**Status:** reviewing
**Spec date:** 2026-05-18
**Last updated:** 2026-05-18
**Author:** spec-coordinator (Claude Sonnet 4.6, 1M)
**Build slug:** deterministic-validators

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Audit & Governance, Agent Runtime |
| Capability owner | platform |
| Lifecycle state on launch | Growth |
| Risk surface | server/db/schema, server/routes, agent runtime |
| Review cadence | quarterly |

---

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | L | No off-the-shelf equivalent integrates with our scorecard/judge pipeline and tenant model |
| Build | L | New framework directory, 10 validators with tests + docs, dispatcher rewrite, 2 DB tables, 2 UI surfaces, CI gates, CLI scaffolding |
| Carry | M | Validator catalogue grows over time; each new validator needs tests + doc + registry entry; audit table accumulates rows at judge-job rate |
| decommission | M | Validator framework tightly coupled to scorecardJudgeJob and scorecard_judgements schema; removal requires migrating all rubrics back to semantic-only and dropping 2 tables |

# Spec: Deterministic Validators alongside LLM-as-Judge

## 1. Goals

1. Introduce a typed deterministic validator layer alongside the existing LLM-as-judge path so quality checks can be classified as `deterministic`, `semantic`, or `hybrid`.
2. Ship a Phase 1 catalogue of 10 named validators with co-located tests, markdown docs, and registry registration.
3. Route deterministic and hybrid checks through a dispatcher in `scorecardJudgeJob.ts` that never falls back silently — catalogue miss produces `inconclusive`, not a semantic judge call.
4. Persist deterministic verdicts to `scorecard_judgements` with two new provenance columns (`evaluation_method`, `validator_slug`, `validator_version`) so the verdict ledger is uniform regardless of which path produced it.
5. Audit every dispatcher invocation in a new `validator_invocations` table (append-only, system-tier).
6. Snapshot each validator's source text and hash in a new `validator_versions` table (immutable, system-tier) written at server startup.
7. Attribute cost correctly: deterministic verdicts cost 0; trend dashboards show cost-saved over time as rubrics adopt deterministic checks.
8. Expose the new rubric fields through the existing scorecard editor UI, admin-gated (Synthetos staff only). Operators see quality checks exactly as today.
9. Ship a `VerdictDrillIn` React component (inside the Inbox) surfacing `evaluation_method`, `validator_slug/version`, and structured evidence for every verdict.
10. Run a two-week pilot on two existing high-volume rubrics (Step 7), measuring cost reduction and verdict agreement vs the prior semantic-only baseline.

## 2. Non-Goals (Phase 1)

- Auto-conversion of existing semantic checks to deterministic (manual, opt-in per rubric author).
- LLM-generates-validator pipeline.
- Validator marketplace or community sharing.
- Per-org or per-subaccount custom validators (system-tier catalogue only).
- Static analysis of skill outputs at authoring time (staged-rollout brief scope).
- Replacing the LLM judge for helpfulness, tone, or factual grounding checks.
- Validator catalogue browser UI (Surface 3 — deferred to Phase 2).
- Sandboxed historical execution for exact-code replay (accepted Phase 1 limitation; see §9.3).

## 3. Framing Assumptions

- The scorecard subsystem (`scorecards`, `scorecard_judgements`, `scorecardJudgeJob.ts`, `scorecardService.ts`) is operational on `main` as described in the brief §2.2.
- `benchExecuteJob.ts` reuses the new dispatcher transparently — no separate bench adaptation needed.
- The closed-loop morning review queue either lands before or after this build; `VerdictDrillIn` ships with whichever build lands first and the second imports it.
- Node.js major version is stable during Phase 1; version pins use `~`-notation in `package.json`.
- The bench subsystem runs deterministic validators identically to live judging — no bypass flag.
## 4. Three "Kind" Namespaces

These three namespaces exist at different layers. The dispatcher is the only layer that translates between them. Keep them distinct throughout spec and implementation.

| Layer | Field | Values | Visible to |
|---|---|---|---|
| Validator implementation | `Validator.kind` | `deterministic` / `deterministic_external` / `hybrid_precondition` | validator authors, dispatcher |
| Quality-check authoring | `QualityCheck.kind` | `deterministic` / `semantic` / `hybrid` | rubric authors (admin UI), dispatcher |
| Verdict provenance | `evaluation_method` | `deterministic` / `deterministic_external` / `hybrid_deterministic_fail` / `hybrid_semantic` / `semantic` | verdict ledger, dashboards, audit |

A `QualityCheck.kind = 'deterministic'` resolves to a `Validator.kind` of either `deterministic` or `deterministic_external`. The resulting verdict's `evaluation_method` records the actual path taken.

## 5. Schema Changes

### 5.1 scorecard_judgements provenance columns

**Migration file:** `migrations/NNNN_deterministic_validators_phase_1.sql`

```sql
ALTER TABLE scorecard_judgements
  ADD COLUMN evaluation_method TEXT NOT NULL DEFAULT 'semantic'
    CHECK (evaluation_method IN (
      'deterministic', 'deterministic_external',
      'hybrid_deterministic_fail', 'hybrid_semantic', 'semantic'
    )),
  ADD COLUMN validator_slug TEXT,
  ADD COLUMN validator_version TEXT;
```

**Backfill:** existing rows receive `evaluation_method = 'semantic'`, `validator_slug = NULL`, `validator_version = NULL`. Null on these columns means "produced by the LLM judge before the deterministic layer." All analytics queries and rollout-gating logic must treat null as equivalent to `'semantic'`.

**RLS:** `scorecard_judgements` already carries tenant RLS. These columns inherit that posture unchanged.

### 5.2 validator_versions table (system-tier)

```sql
CREATE TABLE validator_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  source_text TEXT NOT NULL,
  -- SHA-256 of source_text; enables cheap equality checks
  source_hash TEXT NOT NULL,
  parameter_schema_json JSONB NOT NULL,
  -- replay fidelity: source_text covers this validator's own code only.
  -- full deterministic replay also depends on transitive dependency versions
  -- (JSON Schema lib, regex engine, date parser) and Node.js runtime version,
  -- covered by the version-pinning policy in §6.1. Replay fidelity degrades
  -- if version pins are bumped without re-running historical validations.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slug, version)
);
```

**RLS posture:** system-tier — no `organisation_id`, no `subaccount_id`. Parallels `skill_versions`. Access route-guarded by Synthetos-staff role. Add to `server/config/rlsProtectedTables.ts`:
```typescript
{ table: 'validator_versions', reason: 'system-tier code-shaped reference table; no tenant payload' }
```

**Snapshot write:** at server startup. Registry boot sequence computes `SHA-256(source_text)` per validator then `INSERT INTO validator_versions ... ON CONFLICT (slug, version) DO NOTHING`. Idempotent. ~10ms overhead at Phase 1 catalogue size.
### 5.3 validator_invocations table (system-tier, append-only)

```sql
CREATE TABLE validator_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verdict_id UUID NOT NULL REFERENCES scorecard_judgements(id),
  validator_slug TEXT NOT NULL,
  validator_version TEXT NOT NULL,
  evaluation_method TEXT NOT NULL
    CHECK (evaluation_method IN (
      'deterministic', 'deterministic_external',
      'hybrid_deterministic_fail', 'hybrid_semantic', 'semantic'
    )),
  latency_ms INTEGER NOT NULL,
  external_call_count INTEGER NOT NULL DEFAULT 0,
  result_passed BOOLEAN NOT NULL,
  result_score NUMERIC(4,3) NOT NULL,
  evidence_json JSONB,
  -- nullable; enables reconciliation between audit table and distributed traces
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON validator_invocations (validator_slug, created_at);
CREATE INDEX ON validator_invocations (verdict_id);
```

**Source-of-truth assignment:**
- Cost and skipped-judge counts: `scorecard_judgements`
- Per-invocation latency, external call count, evidence payload: `validator_invocations`
- Live trace correlation: distributed traces (reconcilable via `trace_id` when present)

**RLS posture:** system-tier — no tenant payload beyond the `verdict_id` FK. Tenant reads go via the parent verdict. Add to `server/config/rlsProtectedTables.ts`:
```typescript
{ table: 'validator_invocations', reason: 'system-tier audit ledger; tenant reads via parent verdict FK' }
```

### 5.4 Quality-check JSONB shape

The `quality_checks` JSONB column on `scorecards` gains new fields per check. No JSONB column migration needed — JSONB is schemaless. One DDL change adds the inconclusive-alert threshold:

```sql
ALTER TABLE scorecards
  ADD COLUMN inconclusive_alert_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.20;
```

**TypeScript shape** (`shared/types/scorecardTypes.ts`):

```typescript
interface QualityCheck {
  slug: string;
  name: string;
  passMark: number;
  enabled: boolean;
  // new — all optional with safe defaults:
  kind?: 'deterministic' | 'semantic' | 'hybrid'; // default: 'semantic'
  validatorSlug?: string;           // required if kind === 'deterministic'
  validatorParameters?: Record<string, unknown>;
  preconditionSlugs?: string[];     // required if kind === 'hybrid'
  preconditionParameters?: Record<string, Record<string, unknown>>;
  safetyClass?: boolean;            // default: false
}
```

**Contract example — deterministic:**
```json
{ "slug": "output-schema-valid", "name": "Output matches expected schema",
  "passMark": 1.0, "enabled": true, "kind": "deterministic",
  "validatorSlug": "output_schema_valid",
  "validatorParameters": { "schema": { "type": "object", "required": ["customerId"] } },
  "safetyClass": false }
```

**Contract example — hybrid:**
```json
{ "slug": "output-helpful", "name": "Response is helpful",
  "passMark": 0.7, "enabled": true, "kind": "hybrid",
  "preconditionSlugs": ["output_non_empty", "output_length_within_bounds"],
  "preconditionParameters": { "output_length_within_bounds": { "min": 50, "max": 2000 } },
  "safetyClass": false }
```

**Precondition ordering:** JSONB array order is user-defined and semantically meaningful (short-circuit stops at first failure). Postgres JSONB arrays are ordered; the ORM layer must preserve this ordering and must not sort array elements.

## 6. Validator Framework

### 6.1 TypeScript Contract

**Location:** `server/lib/scorecardValidators/types.ts`

```typescript
export interface RunMetadata {
  skillSlug: string;
  agentId: string;
  subaccountId: string;
  runId: string;
  invokedSkillSlugs: string[]; // populated by dispatcher before calling any validator
}

export interface ValidatorEvidence {
  field?: string;
  expected?: unknown;
  actual?: unknown;
  matchedSubstring?: string;
  missingIds?: string[];
  _truncated?: true; // set when payload was truncated to stay under 4 KB
  [key: string]: unknown; // validator-specific; must be JSON-serialisable
}

export interface ValidatorResult {
  passed: boolean;
  score: number;       // 0.0 or 1.0 for most deterministic; graded only for partial-match validators
  reasoning: string;
  evidence?: ValidatorEvidence; // required when passed === false
}

export interface ValidatorContext {
  runOutput: string;
  runMetadata: RunMetadata;
  entityRecord?: Record<string, unknown>;
  parameters: Record<string, unknown>;
}

export interface ValidatorParameterField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: unknown;
  description: string;
  uiHint?: 'textarea' | 'code-editor' | 'json-schema' | 'slug-picker' | 'number-range';
  validation?: { min?: number; max?: number; pattern?: string; enum?: unknown[] };
}

export interface Validator {
  slug: string;
  version: string; // semantic version e.g. '1.0.0'
  kind: 'deterministic' | 'deterministic_external' | 'hybrid_precondition';
  parameterSchema: ValidatorParameterField[];
  evaluate(ctx: ValidatorContext): Promise<ValidatorResult>;
}
```

**Graded scores:** validators return 0.0 or 1.0 unless they are partial-match validators where "N of M criteria met" is meaningful. Safety-class validators (`safetyClass: true`) must return binary 0.0/1.0. Any validator returning graded scores must document the scoring formula in its markdown doc.

**Evidence size limit:** serialised evidence must not exceed 4 KB. Validators that would exceed this must truncate and set `_truncated: true`. The audit ledger insert rejects payloads exceeding 8 KB as a hard stop.

**Execution isolation (`deterministic` kind):** no filesystem, no `process.env`, no shared mutable state, no network. A static lint rule (`scripts/check-validator-isolation.ts`) rejects imports of `fs`, `process.env`, `net`, `http`, `https`, `db`, `drizzle`, or `pg` in files registered as `deterministic`. Violations fail CI.

**Tenant-isolation invariant:** validators accessing tenant data must use the entity-resolver registry (§6.4). Direct `db`, `drizzle`, or `pg` imports are rejected by the isolation lint rule above.

**Environment determinism:** no locale-sensitive operations, no tokeniser-library-version dependencies, no platform-specific numeric precision. Parsing libraries pinned with `~`-notation in `package.json`.

### 6.2 Registry Pattern

**File:** `server/lib/scorecardValidators/registry.ts`

Self-registration pattern (mirrors `SKILL_HANDLERS`). Each validator file calls `registerValidator(v: Validator)`. The registry:

- Enforces at startup that any validator used in `preconditionSlugs` has `kind: 'deterministic'` or `kind: 'deterministic_external'` (hybrid checks cannot be preconditions — prevents composition cycles; validated O(n²) at Phase 1 catalogue size).
- Reads `server/lib/scorecardValidators/.registry-meta.json` and excludes validators with `testsGreen: false` from the lookup table.
- Returns `undefined` for unknown slugs (dispatcher handles the miss — §7.2).

**Registry meta file** (`server/lib/scorecardValidators/.registry-meta.json`) — CI-written:

```json
{
  "validators": {
    "output_schema_valid": { "testsGreen": true },
    "pii_pattern_absent": {
      "testsGreen": false,
      "skipEnforcement": true,
      "skipEnforcementExpiry": "2026-06-01",
      "reason": "Refactoring PII regex engine — expires 2026-06-01"
    }
  },
  "generatedAt": "2026-05-18T10:00:00Z",
  "ciRunId": "abc123"
}
```

CI validation step fails build if: `testsGreen: false` without `skipEnforcement: true`; `skipEnforcementExpiry` has passed; `skipEnforcement: true` without `skipEnforcementExpiry`. Bypasses older than 7 calendar days surface in the morning review queue as "stale enforcement bypass." No permanent bypass.
### 6.3 CLI Scaffolding

**Command:** `npm run scorecard:new-validator <slug>`

Generates: `server/lib/scorecardValidators/<slug>.ts` (validator skeleton), `<slug>.test.ts` (test skeleton), `<slug>.md` (doc skeleton), and adds the registration entry to `registry.ts`. Same pattern as skill handler scaffolding.

### 6.4 Entity-Resolver Registry

**File:** `server/lib/scorecardValidators/entityResolverRegistry.ts`

Typed map from string key → `(id: string, subaccountId: string) => Promise<boolean>`. Each entry wraps a service-layer call — subaccount scoping is enforced by the service method, not the validator.

```typescript
export const ENTITY_RESOLVERS: Record<
  string,
  (id: string, subaccountId: string) => Promise<boolean>
> = {
  'customerService.existsById': (id, subaccountId) =>
    customerService.existsById(id, subaccountId),
  // additional resolvers added per catalogue needs
};
```

Phase 1 registers only the resolvers needed by the Phase 1 catalogue. Adding a new entity type = one registry entry + service wrapper. The isolation lint rule blocks direct `db` imports from validator files; all tenant lookups must flow through this registry.

### 6.5 Test Discipline

Each validator ships with:
- A **passing-case test** — input that should pass.
- A **failing-case test** — input that should fail.
- An **edge-case test** — the specific reason this validator exists (a known gaming attempt or known false-positive).

Tests run in CI via `npx vitest run server/lib/scorecardValidators/`. The CI step writes `.registry-meta.json` with per-validator `testsGreen` values. A validator excluded from the registry (testsGreen: false, no bypass) causes the dispatcher to write `inconclusive`.

### 6.6 Documentation Requirement

Each validator includes `server/lib/scorecardValidators/<slug>.md` covering:
- What it checks
- What it does not check
- Known false-positive and false-negative cases
- Which gaming attempts it is designed to defeat
- Scoring formula (if graded)
- Truncation logic (if evidence can exceed 4 KB)
- Tenant-data lookup service name (if applicable, so reviewers can verify scoping path)

## 7. Dispatcher

### 7.1 Location

`server/jobs/scorecardJudgeJob.ts` — dispatcher added at the top of every quality-check evaluation loop. Reads `QualityCheck.kind` and routes accordingly.

### 7.2 Routing Table

| `QualityCheck.kind` | Behaviour |
|---|---|
| `deterministic` | Look up validator from registry. If found and `testsGreen`, evaluate and write verdict (`evaluation_method = 'deterministic'`). If not found or excluded: `inconclusive` (catalogue miss — **no fallback to semantic**). |
| `deterministic_external` | Same, with timeout (5s default) and one retry. Both fail: `inconclusive` with external-dependency reasoning. `evaluation_method = 'deterministic_external'`. |
| `hybrid` | Evaluate each validator in `preconditionSlugs` in declared order (short-circuit on first failure). Gate fail: write verdict with `evaluation_method = 'hybrid_deterministic_fail'`, `score = 0.0`, `reasoning = "deterministic gate <slug> failed: <reason>"`, `evidence = full gate ValidatorEvidence`. Gate pass: fall through to semantic judge, write verdict with `evaluation_method = 'hybrid_semantic'`. Precondition pass events written to `validator_invocations`, not as separate `scorecard_judgements` rows. |
| `semantic` | Existing Haiku judge path unchanged. `evaluation_method = 'semantic'`. |

**Catalogue miss → `inconclusive`, no fallback.** Silent fallback would hide rubric drift; inconclusive surfaces it in the morning review queue as "validator not found."

**Parameter schema mismatch:** if a now-required field is absent from the rubric's stored parameters: write `inconclusive` with `reasoning = 'parameter schema mismatch: validator <slug> at version <v> requires field <field> which is absent'`. Surfaces in morning review queue under "Rubric needs update." No auto-migration.

**Idempotency posture (state-based):** `INSERT INTO scorecard_judgements ... ON CONFLICT (judgement_run_id, check_slug) DO NOTHING`. Existing verdict wins on re-invocation. Retry of `deterministic_external` validators happens before the verdict write — retry never produces a duplicate row. Unique index name: `scorecard_judgements_judgement_run_id_check_slug_key` (confirm before Phase 2 build starts).

### 7.3 Inconclusive Verdict Contribution

`inconclusive` verdicts are excluded from pass rate, fail rate, and aggregate scorecard percentage. They appear as a distinct third category in the morning review queue, cost dashboards, and verdict drill-in.

**Inconclusive threshold alert:** after all check verdicts are written for a run, the dispatcher counts inconclusive verdicts. If `inconclusive_count / total_checks > scorecard.inconclusive_alert_threshold` (default 0.20), emits a monitoring alert via Synthetos channel: "rubric drift detected — {N} of {M} checks inconclusive for scorecard {id}." Fire-and-forget; non-blocking.

### 7.4 External Validator Reliability Policy (`deterministic_external`)

- **Timeout:** 5s default per invocation.
- **Retry:** one retry on failure.
- **Concurrency:** maximum 3 concurrent external validator calls per judgement run (semaphore in dispatcher).
- **Rate limit:** 100 calls/minute per subaccount-scoped validator slug; excess → `inconclusive` with "rate limit exceeded."
- **Circuit breaker:** >20% error rate over any 5-minute window → circuit opens; while open, all calls return `inconclusive` immediately. Closes after 2 consecutive successful health-check calls (one per minute). State store: in-memory map on job worker, reset on restart. **Accepted Phase 1 tradeoff:** state clears on rolling deploy/crash; a downed dependency re-trips within one 5-minute window after restart.
- **p95 latency alert:** if a validator's p95 latency exceeds 1 second (from `validator_invocations.latency_ms` over a rolling 24-hour window), emit monitoring alert via Synthetos channel. Non-blocking; no UI badge in Phase 1.
### 7.5 RunMetadata Population

Before calling any validator, the dispatcher populates `RunMetadata.invokedSkillSlugs: string[]` from the run record. This allows `action_set_within_allowlist` to remain `kind: 'deterministic'` (pure, no external call).

### 7.6 Safety-Class Operational Semantics

A `safetyClass: true` check that fails triggers, in order:
1. Aggregate verdict for the current evaluation run set to `failed` immediately (regardless of remaining checks).
2. Any amendment under closed-loop review touching a skill with a failing safety-class check is blocked from promotion until the check is green.
3. Staged-rollout pipeline treats it as a hard stop — rollout percentage frozen until green for two consecutive evaluation windows.
4. Alert emitted to Synthetos monitoring channel.

A single failing safety-class verdict triggers all four effects.

## 8. Phase 1 Validator Catalogue

10 validators ship with Phase 1. Each ships with passing-case, failing-case, and edge-case tests plus a markdown doc.

| Slug | `Validator.kind` | Safety class | What it checks |
|---|---|---|---|
| `output_schema_valid` | `deterministic` | no | Output parses to JSON Schema 2020-12 supplied via parameters |
| `output_length_within_bounds` | `deterministic` | no | Character or token count between `min` and `max` parameters |
| `output_non_empty` | `deterministic` | no | Output is not the empty string after trimming whitespace |
| `no_forbidden_phrase` | `deterministic` | no | None of the parameter-supplied phrases or regexes match. Graded: `(phrases_clean / phrases_total)` when partial match is meaningful |
| `pii_pattern_absent` | `deterministic` | yes | None of a curated PII pattern set (email, phone, credit card, TFN, SSN-shape) match. Defence-in-depth only — doc must state this caveat explicitly |
| `cited_entity_exists` | `deterministic_external` | no | Every entity ID referenced in the output exists in the relevant subaccount table via `entityResolverRegistry`. Parameters: `{ entityTypes: Array<{ matchPattern: string; lookupService: string; idArgName: string }> }`. Single batched call per entity type per invocation |
| `action_set_within_allowlist` | `deterministic` | yes | Every skill in `RunMetadata.invokedSkillSlugs` is in the parameter-supplied allowlist |
| `numeric_within_tolerance` | `deterministic` | no | Named numeric field extracted from output is between `min` and `max` |
| `date_in_format` | `deterministic` | no | Named date field extracted from output parses to ISO 8601 |
| `output_helpful` (reference hybrid) | hybrid (rubric JSONB pattern, not a standalone Validator entry) | no | `preconditionSlugs: ['output_non_empty', 'output_length_within_bounds']`. Reference implementation of the hybrid pattern — both preconditions must pass before semantic judge evaluates helpfulness |

**Note on `output_helpful`:** this is a rubric JSONB pattern, not a standalone `Validator` registered in the catalogue with its own `Validator.kind`. The validator dropdown in the rubric editor should not list it. Phase 2 should evaluate a "hybrid templates" picker for rubric authors (see §19).
## 9. Versioning, Audit, and Observability

### 9.1 Validator Versioning

Each validator carries `version: string` (semantic version, e.g. `'1.0.0'`). `validator_versions` rows are immutable (§5.2). Verdicts persist `validator_version` alongside `validator_slug`.

**Versioning rules:**
- Adding a non-required parameter field: backward-compatible; version bump not required.
- Adding a required field or removing a field: breaking change; new version required; migration note in the validator's markdown doc.

**Deprecation lifecycle:** deprecated validators (1) remain executable for historical replay; (2) are excluded from the rubric editor dropdown; (3) appear with a "deprecated" badge in Surface 3 (deferred); (4) emit "rubric references deprecated validator — migration recommended" in the morning review queue for active rubrics. A deprecated validator can only be permanently removed after a migration check confirms zero active `quality_checks` rows reference its slug across all subaccounts.

### 9.2 Audit Ledger

Every dispatcher invocation writes one row to `validator_invocations` (§5.3). Source of truth for:
- Cost-savings analysis (semantic-judge calls avoided per week).
- Validator quality analysis (false-positive rate per operator-correction signal).

### 9.3 Replay Fidelity (Known Limitation)

`validator_versions` snapshots the validator's own source text. Full deterministic replay also depends on transitive dependency versions (JSON Schema library, regex engine, date parser) and the Node.js runtime version — covered by the version-pinning policy (§6.1) and the deployment manifest. **If validator logic changes materially, historical replay runs current logic against historical context and may produce different results.** Accepted Phase 1 tradeoff; Phase 2 evaluates sandboxed execution only if regulatory requirements emerge.

### 9.4 Cost Attribution

Deterministic verdicts record `cost = 0` in `scorecard_judgements`. Trend dashboards show cost-saved over time as more rubrics adopt deterministic checks.

### 9.5 Observability

- **Semantic path:** existing `gen_ai.*` OpenTelemetry attributes unchanged.
- **Deterministic path:** new OTel attributes: `synthetos.validator.slug`, `synthetos.validator.version`, `synthetos.validator.latency_ms`, `synthetos.validator.evaluation_method`.
- **Hybrid:** trace span includes both attribute sets.
- **`trace_id`:** written to `validator_invocations.trace_id` when OTel trace context is available; null otherwise.

### 9.6 Alert Routing

All operational alerts (safety-class failure §7.6, inconclusive threshold §7.3, circuit-breaker open §7.4, p95 latency breach §7.4) route through the existing Synthetos incident infrastructure — same channel and escalation path as existing scorecard failures. Ownership: Synthetos platform engineering on-call.

## 10. UI Surfaces

**Mockup:** `prototypes/deterministic-validators.html` (3 rounds, CLEAN after Round 3). Screen 1 shows operator vs admin view toggle. Screen 2 shows three verdict variants (deterministic pass, hybrid gate fail, inconclusive) as a drill-in panel inside the Inbox.

### 10.1 Surface 1 — Rubric Quality-Check Editor (admin-gated)

**Pages to extend:**
- `client/src/pages/govern/ScorecardCreatePage.tsx`
- `client/src/pages/agents/AgentEditScorecardTab.tsx`
- `client/src/pages/agents/AgentCreateScorecardSection.tsx`
- `client/src/pages/govern/ScorecardLibraryTab.tsx`

**Operator view (default, unchanged):** quality-check row shows name, description, pass mark %, enabled toggle, remove. No validator controls visible.

**Admin / Synthetos staff view (gated):** below each check's existing fields, a "Validator configuration" section with a muted "Staff" pill badge. Contains:

- **"Check kind" selector** (not "Evaluation method" — reserved for the verdict provenance enum): `deterministic` | `semantic` | `hybrid`. Default `semantic`.
- When `kind = deterministic`: `validatorSlug` dropdown (non-deprecated validators only; human-readable name as primary label, slug as secondary muted text) + parameter form from `ValidatorParameterField[]` using `uiHint` for control types.
- When `kind = hybrid`: ordered list of precondition entries (validator dropdown + parameter form per entry; add/remove/reorder; UI labels the cheapest-first heuristic) + semantic prompt field below.
- **`safetyClass` toggle** with helper text: "Failing this check immediately flags the run and blocks automated promotions."

**Parameter form generation:** generic `ValidatorParameterField[]`-driven renderer using `uiHint`. No per-validator React fragments in Phase 1.

**Validator API — new route:**

```
GET /api/validators
Authorization: requirePermission('synthetos_staff')
Response: ValidatorSummary[]

interface ValidatorSummary {
  slug: string;
  name: string;          // human-readable; from validator markdown doc h1
  kind: 'deterministic' | 'deterministic_external' | 'hybrid_precondition';
  safetyClass: boolean;
  deprecated: boolean;
  parameterSchema: ValidatorParameterField[];
}
```

### 10.2 Surface 2 — VerdictDrillIn Component

**Component path:** `client/src/components/verdicts/VerdictDrillIn.tsx`

**Pinned prop interface (spec-locked — whichever build ships it first, the other imports this contract):**

```typescript
interface VerdictDrillInProps {
  evaluationMethod: 'deterministic' | 'deterministic_external'
    | 'hybrid_deterministic_fail' | 'hybrid_semantic' | 'semantic' | 'inconclusive';
  validatorSlug?: string;
  validatorVersion?: string;
  evidence?: ValidatorEvidence;
  reasoning: string;
  gateEvidence?: ValidatorEvidence; // hybrid_semantic: the passed gate's evidence
}
```

**Display rules:**

| `evaluationMethod` | Display |
|---|---|
| `deterministic` / `deterministic_external` | Evaluation method badge · validator slug + version · evidence as key/value table |
| `hybrid_deterministic_fail` | Gate evidence (key/value table) · "Judge was not called — gate failed" note |
| `hybrid_semantic` | `gateEvidence` collapsible "Gate passed" section · semantic judge reasoning below |
| `semantic` | Reasoning text only · no validator fields |
| `inconclusive` | Warning callout: "This rubric references a validator that no longer exists or whose tests are failing. Edit the rubric to fix or remove this check." |

**Surface location note:** the spec-phase must decide whether verdict drill-ins live as a lane inside the existing "Needs Review" tab (current mockup) or in the closed-loop brief's `improvements-section` pattern. Both are defensible; the decision must be recorded in `tasks/builds/deterministic-validators/progress.md` before Phase 2 begins (§19 open question 1).

**New React component:** `client/src/components/verdicts/ValidatorParameterForm.tsx` — generic `ValidatorParameterField[]`-driven parameter form renderer, also reused by Surface 1.

### 10.3 Surface 3 — Validator Catalogue Browser (deferred)

Read-only admin index of Phase 1 validators. Not load-bearing for Phase 1. Defer to Phase 2 if a Synthetos staff operator requests it.

## 11. Phase Sequencing

**Step 1 — Schema migrations** (no behaviour change)
- Add `evaluation_method`, `validator_slug`, `validator_version` to `scorecard_judgements`.
- Create `validator_versions` and `validator_invocations` tables.
- Add `inconclusive_alert_threshold` to `scorecards`.
- Add both new tables to `server/config/rlsProtectedTables.ts` as explicit opt-outs.

**Step 2 — Validator framework**
- `server/lib/scorecardValidators/` directory.
- `types.ts`, `registry.ts`, `entityResolverRegistry.ts`.
- CLI scaffolding (`npm run scorecard:new-validator`).
- Isolation lint rule (`scripts/check-validator-isolation.ts`).
- `.registry-meta.json` CI write step + validation step.
- Single canonical example validator for testing the framework.

**Step 3 — Dispatcher**
- Modify `scorecardJudgeJob.ts`: read `kind`, route to catalogue or semantic judge.
- Write `evaluation_method` on every verdict.
- Catalogue miss + parameter mismatch → `inconclusive`.
- Safety-class fail effects (§7.6).
- Inconclusive threshold alert (§7.3).
- External validator semaphore, rate limit, circuit breaker (§7.4).
- `validator_invocations` write per invocation.
- `RunMetadata.invokedSkillSlugs` population before dispatch.

**Step 4 — Phase 1 catalogue (10 validators)**
- Author each validator: `<slug>.ts`, `<slug>.test.ts`, `<slug>.md`.
- Registry registration entry.
- Safety-class tags on `pii_pattern_absent` and `action_set_within_allowlist`.

**Step 5 — Audit and observability**
- `validator_invocations` writes wired from dispatcher.
- OTel `synthetos.validator.*` attributes.
- Deterministic verdicts write `cost = 0`.
- `validator_versions` startup upsert wired from registry boot.

**Step 6 — UI surfaces**
- `GET /api/validators` route (staff-only).
- Admin-gated validator configuration section in all 4 pages.
- `VerdictDrillIn` React component.
- `ValidatorParameterForm` React component.

**Step 7 — Pilot** (two-week observation)
- Convert two high-volume rubrics to deterministic validators.
- Measure cost reduction and verdict agreement vs semantic-only baseline (methodology: §1 goal 10).
- Document outcome.

**Step 8 — Documentation**
- One-page rubric-author guide: when to use deterministic vs hybrid vs semantic, with worked examples from the pilot.

**Dependency graph (no backward references):**
Step 2 → Step 1 (startup upsert needs tables). Step 3 → Step 2 (registry must exist). Step 4 → Step 2 (framework must exist). Step 5 → Steps 3, 4. Step 6 → Steps 1, 2. Step 7 → Steps 3, 4, 5. Step 8 → Step 7.
## 12. File Inventory

| File | Change | Notes |
|---|---|---|
| `migrations/NNNN_deterministic_validators_phase_1.sql` | new | scorecard_judgements columns + validator_versions + validator_invocations + inconclusive_alert_threshold |
| `server/db/schema/scorecardJudgements.ts` | modify | evaluation_method, validator_slug, validator_version |
| `server/db/schema/validatorVersions.ts` | new | validator_versions table |
| `server/db/schema/validatorInvocations.ts` | new | validator_invocations table |
| `server/db/schema/scorecards.ts` | modify | inconclusive_alert_threshold column |
| `server/config/rlsProtectedTables.ts` | modify | add validator_versions and validator_invocations as system-tier opt-outs |
| `shared/types/scorecardTypes.ts` | new/modify | QualityCheck interface with new fields |
| `server/lib/scorecardValidators/types.ts` | new | Validator, ValidatorContext, ValidatorResult, ValidatorEvidence, ValidatorParameterField, RunMetadata |
| `server/lib/scorecardValidators/registry.ts` | new | registry, startup upsert, .registry-meta.json reader |
| `server/lib/scorecardValidators/entityResolverRegistry.ts` | new | typed entity-resolver map |
| `server/lib/scorecardValidators/.registry-meta.json` | new (CI-written) | per-validator testsGreen + skipEnforcement |
| `server/lib/scorecardValidators/output_schema_valid.ts` | new | + test + doc |
| `server/lib/scorecardValidators/output_length_within_bounds.ts` | new | + test + doc |
| `server/lib/scorecardValidators/output_non_empty.ts` | new | + test + doc |
| `server/lib/scorecardValidators/no_forbidden_phrase.ts` | new | + test + doc |
| `server/lib/scorecardValidators/pii_pattern_absent.ts` | new | + test + doc (safety-class) |
| `server/lib/scorecardValidators/cited_entity_exists.ts` | new | + test + doc (deterministic_external) |
| `server/lib/scorecardValidators/action_set_within_allowlist.ts` | new | + test + doc (safety-class) |
| `server/lib/scorecardValidators/numeric_within_tolerance.ts` | new | + test + doc |
| `server/lib/scorecardValidators/date_in_format.ts` | new | + test + doc |
| `scripts/check-validator-isolation.ts` | new | CI isolation lint rule |
| `server/jobs/scorecardJudgeJob.ts` | modify | dispatcher: kind routing, verdict composition, inconclusive logic, safety-class effects, external reliability, validator_invocations write, RunMetadata population |
| `server/routes/validators.ts` | new | GET /api/validators (staff-only) |
| `client/src/pages/govern/ScorecardCreatePage.tsx` | modify | admin-gated validator configuration section |
| `client/src/pages/agents/AgentEditScorecardTab.tsx` | modify | same |
| `client/src/pages/agents/AgentCreateScorecardSection.tsx` | modify | same |
| `client/src/pages/govern/ScorecardLibraryTab.tsx` | modify | same |
| `client/src/components/verdicts/VerdictDrillIn.tsx` | new | VerdictDrillIn component |
| `client/src/components/verdicts/ValidatorParameterForm.tsx` | new | generic parameter form renderer |

**Count reconciliation:** 1 migration, 4 schema files modified/added, 1 config modified, 1 shared type, 3 framework files, 1 CI-written meta file, 10 validators (each = .ts + .test.ts + .md = 30 files), 1 CI lint script, 1 job modified, 1 route new, 4 pages modified, 2 new components. Total new/modified: ~50 files.

## 13. Permissions / RLS Checklist

**`validator_versions`:** system-tier, no `organisation_id`/`subaccount_id`. Explicit opt-out in `rlsProtectedTables.ts`. Access route-guarded by Synthetos-staff permission.

**`validator_invocations`:** system-tier, no tenant payload beyond `verdict_id` FK. Explicit opt-out in `rlsProtectedTables.ts`. Tenant reads via parent verdict.

**`scorecard_judgements` new columns:** inherit existing RLS posture unchanged.

**`scorecards` new column:** inherits existing RLS posture unchanged.

**`GET /api/validators`:** guarded by `requirePermission('synthetos_staff')`.

**Admin UI section:** conditionally rendered based on `synthetos_staff` permission check.

**Canonical RLS posture:** RLS enforces the organisation boundary; subaccount filtering is service-layer. The two new tables are system-tier opt-outs per the canonical `rlsProtectedTables.ts` mechanism.
## 14. Execution Model

- **Validator dispatch:** inline / synchronous within `scorecardJudgeJob.ts`. The job iterates checks sequentially; the dispatcher extends that loop.
- **`deterministic_external` validators:** synchronous within the job (timeout + one retry inline, then move on). Not queued separately.
- **`validator_invocations` writes:** synchronous within the job, after the verdict is written.
- **`validator_versions` upsert:** synchronous at server startup, before the HTTP server accepts connections.
- **Monitoring alerts:** fire-and-forget (non-blocking) within the job.

## 15. Execution-Safety Contracts

### 15.1 Idempotency Posture

- **Verdict writes (state-based):** `INSERT INTO scorecard_judgements ... ON CONFLICT (judgement_run_id, check_slug) DO NOTHING`. Existing verdict wins on re-invocation.
- **`validator_invocations` writes:** append-only; no uniqueness key (each invocation row is unique by definition). Retry of `deterministic_external` validators happens before the verdict write — retry never produces a duplicate verdict row.
- **`validator_versions` upsert:** `ON CONFLICT (slug, version) DO NOTHING`. Safe on every restart.

### 15.2 Retry Classification

- **Deterministic `evaluate()`:** `safe` — pure function, unconditionally retryable.
- **`deterministic_external` `evaluate()`:** `guarded` — one retry before verdict write; bounded and cannot produce a duplicate verdict row.
- **Verdict write:** `guarded` — `ON CONFLICT DO NOTHING` makes it idempotent.
- **`validator_invocations` write:** `safe` — append-only, no constraint conflict possible.

### 15.3 Concurrency Guard

- **Verdict write race:** existing `UNIQUE (judgement_run_id, check_slug)` index on `scorecard_judgements` ensures first-write wins. A concurrent duplicate write returns 0 rows affected (`DO NOTHING`) and the caller discards. HTTP mapping: not applicable (internal to the job).
- **External validator concurrency:** enforced by the semaphore in the dispatcher (maximum 3 concurrent external calls per judgement run).

### 15.4 No Silent Partial Success

The judge job emits a terminal event per run (existing behaviour, unchanged). If any safety-class check fails, the aggregate verdict is `failed` immediately (§7.6). If the job fails mid-run via uncaught exception, no terminal event is emitted — existing behaviour, unchanged.

### 15.5 Unique Constraint → HTTP Mapping

- `scorecard_judgements (judgement_run_id, check_slug)`: internal; `DO NOTHING` path not exposed via HTTP.
- `validator_versions (slug, version)`: internal; `DO NOTHING` on startup upsert. Not exposed via HTTP.

## 16. Coexistence Invariant with Closed-Loop Brief

The closed-loop brief states: "deterministic validators are authoritative where available; semantic judges may supplement but not override deterministic failures." This is honoured structurally:

1. **One kind per check.** A `QualityCheck` carries exactly one `kind`. The rubric editor rejects rubrics naming two checks with the same `slug` differing in kind.
2. **Hybrid is the only path where both fire on the same check.** If the gate fails, the semantic judge is skipped and the verdict is `failed`. The semantic judge can only produce a verdict when all preconditions pass — it can never override a deterministic `fail`.

## 17. Testing Posture

Per `docs/spec-context.md`:
- **Static gates primary.** The isolation lint rule (`check-validator-isolation.ts`) is a CI gate.
- **Pure function tests for validators.** Each validator's test file runs via `npx vitest run server/lib/scorecardValidators/`. Tests are pure (no DB, no network for `deterministic` kind); `deterministic_external` tests mock the external dependency.
- **No API contract tests, no E2E tests, no frontend unit tests** in Phase 1 — deferred per `docs/spec-context.md`.
- **Pilot (Step 7)** serves as the integration validation — real rubrics, real runs, real cost measurement.

## 18. Deferred Items

- **Validator catalogue browser (Surface 3).** Deferred to Phase 2.
- **Suggest deterministic conversions tool.** Scans existing semantic rubrics and proposes validators. Phase 2.
- **Per-org / per-subaccount custom validators.** System-tier catalogue only in Phase 1.
- **Sandboxed historical execution for exact-code replay.** Accepted Phase 1 limitation (§9.3). Phase 2 if regulatory requirements emerge.
- **VerdictDrillIn surface location decision.** "Needs Review" lane vs `improvements-section` pattern. Must be resolved before Phase 2 begins (§10.2, §19 Q1).
- **p95 latency UI badge.** Monitoring alert only in Phase 1.
- **`output_helpful` hybrid template discovery.** How rubric authors discover and configure hybrid patterns without a "hybrid templates" picker. Phase 2 (§19 Q2).

## 19. Open Questions for Phase 2

1. **VerdictDrillIn surface location:** "Needs Review" lane vs `improvements-section` pattern (§10.2). Record decision in `tasks/builds/deterministic-validators/progress.md` before Phase 2 build begins.
2. **Hybrid template discovery:** how do rubric authors discover and configure hybrid patterns if the composition pattern is not in the validator catalogue dropdown? Phase 2 should evaluate a "hybrid templates" picker alongside the catalogue.
3. **Validator catalogue browser (Surface 3):** scope and ship in Phase 2 if a Synthetos staff operator requests it.

## 20. Self-Consistency Pass

- Goals §1 match implementation §§5–11. Each goal has a named mechanism.
- Phase dependency graph: Steps 1–8 have no backward references (Step 2 requires Step 1 tables; Step 3 requires Step 2 registry; etc.).
- Numeric count reconciliation: 1 migration (or 2 split), 10 validators, 2 new system-tier tables, 4 schema changes, 4 pages modified, 2 new components, 1 new route. All consistent with §12.
- Source-of-truth claims: verdict ledger = `scorecard_judgements`; per-invocation audit = `validator_invocations`; validator source = `validator_versions`; trace correlation = `trace_id` column. All named above.
- Every load-bearing claim has a named mechanism: idempotency by named index (§15.1); concurrency guard by named semaphore (§15.3); safety-class by named ordered effects (§7.6); inconclusive threshold by named column (§7.3); isolation by named lint rule (§6.1).
- No latency budget or cache-efficiency claims introduced (deterministic validators are sub-millisecond by construction).
- Testing posture consistent with `docs/spec-context.md` (static gates + pure function tests; no E2E, no frontend unit tests, no API contract tests).
