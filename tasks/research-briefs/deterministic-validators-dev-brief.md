# Deterministic validators alongside LLM-as-judge: dev-session brief

**Status.** Pre-spec brief, ready for a dev session that produces a full spec.
**Owner.** Product (Synthetos).
**Last updated.** 2026-05-18 — cross-brief review pass: UI surfaces added (§3.7), kind-vocabulary collision resolved (§3.1, §3.2, §3.3), coexistence invariant from closed-loop brief incorporated (§3.3), RLS opt-out pinned for system-tier tables (§3.6), `cited_entity_exists` parameter shape pinned (§3.5), verdict-write idempotency posture pinned (§3.3).
**Source material.** Werner Vogels keynote at AWS Sydney Summit Day 2 (transcript file `2026-05-13 09-15-13`), specifically the automated reasoning section near the end of the keynote (Pythagoras / right-angle triangle example, neurosymbolic feedback loop, Amazon S3 strong-consistency proof). Companion brief: closed-loop skill improvement (`tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md`).

**Key framing.** This brief is a complementary defence layer for the closed-loop self-improvement work. The closed-loop brief depends on LLM-as-judge verdicts being trustworthy; this brief reduces the surface area where LLM judging is the only signal by introducing typed deterministic validators that run before the judge. Goal: 60-80% of quality-check evaluations should be reducible to deterministic validators, leaving LLM judges for genuine semantic surface only. Deterministic validators cannot be gamed, are sub-millisecond cheap, and are explainable by construction.

---

## Contents

1. One-paragraph summary
2. Context
   - 2.1 Glossary
   - 2.2 What exists today (with file paths)
   - 2.3 Why deterministic-first matters
3. Architectural decisions
   - 3.1 Validator primitive (new)
   - 3.2 Quality check classification (deterministic / semantic / hybrid)
   - 3.3 Execution order and verdict composition
   - 3.4 Validator authoring framework
   - 3.5 Built-in validator catalogue (Phase 1 set)
   - 3.6 Versioning, audit, and observability
   - 3.7 UI surfaces
4. What is explicitly out of scope (Phase 1)
5. Sequencing inside Phase 1
6. Open questions for the dev session
7. Success criteria
8. Known failure modes we are designing against
9. What this brief is not

---

## 1. One-paragraph summary

We are introducing a typed deterministic validator layer alongside the existing LLM-as-judge subsystem. Each scorecard quality check is reclassified as one of three kinds: deterministic (a rule that is mathematically or logically checkable, like schema validity, length bounds, forbidden phrases, foreign-key existence, action-set membership), semantic (genuinely requires reasoning to evaluate, like helpfulness, tone, factual grounding), or hybrid (a deterministic gate runs first, judge runs only if it passes). Deterministic checks run sub-millisecond, never call an LLM, are persisted to the same `scorecard_judgements` ledger as judge verdicts, and cannot be gamed by the model whose output they are evaluating. The closed-loop self-improvement work depends on judge verdicts being trustworthy; this brief reduces the surface area where judgement is the only signal, by replacing as much LLM judging as we can with deterministic rules whose correctness is by construction.

## 2. Context

### 2.1 Glossary

- **Quality check.** One named criterion within a scorecard rubric (slug, name, pass mark, enabled flag). Today every quality check is evaluated by the LLM judge.
- **Verdict.** The result of evaluating a quality check against a sampled run: pass / fail / inconclusive, with a numeric score and reasoning text. Persisted to `scorecard_judgements`.
- **LLM-as-judge (today).** Claude Haiku reads the run summary, the rubric, and the quality check, and produces a JSON verdict.
- **Deterministic validator (new).** A typed function that takes the run output (and optionally the entity record) and returns a verdict by applying a mathematical or logical rule. No LLM call. No randomness.
- **Semantic validator.** Same shape, but the underlying implementation is the LLM judge. Equivalent to today's behaviour.
- **Hybrid validator.** A pair: a deterministic precondition that runs first, followed by a semantic evaluator that runs only if the precondition passes. Cheapest correct path through the rubric.
- **Validator catalogue.** The library of named, versioned, reusable deterministic validators that quality checks can reference.
- **Neurosymbolic feedback loop.** The pattern from the Werner Vogels keynote: the LLM generates an output, a deterministic validator checks it, and any violation feeds back as context for the next attempt. Combines the breadth of LLM reasoning with the rigour of formal verification.

### 2.2 What exists today (with file paths)

Everything below is operational on `main`. The brief extends it; no rework of these subsystems is in scope.

**Scorecard subsystem (the substrate this brief modifies):**
- `server/db/schema/scorecards.ts` — rubric storage; `quality_checks` JSONB array containing slug, name, passMark, enabled.
- `server/db/schema/scorecardJudgements.ts` — immutable verdict rows with frozen rubric snapshot, observed score, verdict enum, reasoning text.
- `server/jobs/scorecardJudgeJob.ts` — Claude Haiku judge worker; deterministic sampling; per-check JSON scoring 0.0-1.0; verdict computed by comparing observedScore to passMark.
- `server/services/scorecardService.ts` — CRUD and attachment to agents.

**Bench subsystem (reuses the judge for model comparison):**
- `server/jobs/benchExecuteJob.ts`, `server/db/schema/benchRuns.ts` — runs candidate models against sampled past runs using the same judge logic. Phase 1 must keep this compatible: bench reuses the new validator layer transparently.

**Memory and skill resolver (relevant for the future hybrid validators that need entity context):**
- `server/services/memoryBlockService.ts`, `server/services/skillService.ts` — provide the entity records and resolved skill bodies that some deterministic validators will need to inspect.

**LLM ledger (for cost attribution):**
- `server/db/schema/llmRequests.ts` and `server/services/systemPnlService.ts` — track cost per LLM call. Phase 1 adds a row type for "validator-skipped judge" so we can quantify the cost reduction.

**Closed-loop dependencies (the brief that this brief defends):**
- `tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md` — the post-failure root-cause synthesis, amendment proposer, and morning review queue all consume scorecard verdicts as input. Their robustness depends on those verdicts being hard to game; this brief is the structural defence.

### 2.3 Why deterministic-first matters

Three converging pressures.

**The Werner Vogels framing.** The keynote example is small but the lesson is exact: an LLM does not know what a right-angle triangle is. It has no grounding in `a² + b² = c²`. It will produce something that *looks* like an answer to a maths question, including answers that are wrong in ways the model itself cannot detect. The fix Amazon uses internally is to pair the LLM with a deterministic validator that has the maths. If the LLM violates the constraint, the violation is fed back as context and the model tries again. This is the neurosymbolic feedback loop. Synthetos already runs the LLM half (the judge); this brief adds the deterministic half.

**The judge-gaming failure mode.** Three independent research passes (Claude, Gemini, ChatGPT) on closed-loop self-improvement converged on the same warning: when an LLM judges output that an LLM has produced, the judge's blind spots are the model's optimisation gradient. Dropbox's optimiser copied example-specific keywords into the judge prompt. Reflexion rewrote the task to match what the judge would accept. Meta-Rewarding documented score inflation over time. **Deterministic validators cannot be gamed.** A check that asks "does the output parse to schema X" returns the same answer no matter how the model phrases its response. A check that asks "does the cited entity exist in the database" cannot be tricked by sycophantic phrasing.

**Cost and latency.** The current Haiku judge costs a few cents per invocation and takes a couple of seconds. A deterministic validator costs zero and takes sub-millisecond. If 60-80% of quality checks are reducible to deterministic rules (our estimate based on the catalogue in §3.5), the cost of the scorecard subsystem drops by roughly the same factor, and the latency variance disappears. This matters because the closed-loop work increases the total volume of judging substantially: every scorecard fail triggers a post-mortem, which re-judges the proposed amendment, which becomes part of the regression set, which is re-judged on every acceptance.

## 3. Architectural decisions

### 3.1 Validator primitive (new)

A validator is a typed function in TypeScript with a stable contract. Located in a new directory `server/lib/scorecardValidators/` with one file per validator.

**Contract:**

```typescript
export interface ValidatorContext {
  runOutput: string;              // the model's raw output
  runMetadata: RunMetadata;       // skill slug, agent id, subaccount id, etc.
  entityRecord?: EntityRecord;    // optional: customer, deliverable, etc.
  parameters: Record<string, unknown>; // per-check parameters from the rubric
}

export interface ValidatorResult {
  passed: boolean;
  score: number;                  // 0.0-1.0; usually 1.0 or 0.0 for deterministic, can be graded
  reasoning: string;              // human-readable explanation
  evidence?: Record<string, unknown>; // structured detail (matched substring, missing field, etc.)
}

export interface Validator {
  slug: string;                   // e.g. 'output_schema_valid'
  kind: 'deterministic' | 'deterministic_external' | 'hybrid_precondition';
  evaluate(ctx: ValidatorContext): Promise<ValidatorResult>;
}
```

**Constraints on the contract:**

- Validators are pure where possible (`deterministic`). Same input → same output, no side effects, no network calls.
- Validators that must call external services (`deterministic_external`) — like checking whether a URL responds with 2xx — are marked separately so they can be retried, timed out, or skipped under load.
- Hybrid preconditions return a binary decision: yes-judge-this or no-skip-judging. They do not produce a verdict on their own; they gate.
- `evidence` is structured so the morning review queue can show *why* a check failed without re-running the validator.

**Why TypeScript functions and not a DSL.** A code-first validator framework gives us types, tests, code review, and IDE support. A DSL would invite the same overfitting that free-text overlays invited (per the closed-loop brief). Authoring a new validator should feel like writing a small unit test, not configuring a rules engine.

**Three "kind" namespaces — keep them distinct.** This brief uses the word *kind* in three places at different layers of abstraction; the spec must hold them apart to avoid the conflation the brief originally invited.

| Layer | Field | Values | Visible to |
|---|---|---|---|
| Validator implementation (this section) | `Validator.kind` | `deterministic` / `deterministic_external` / `hybrid_precondition` | validator authors, dispatcher |
| Quality-check authoring (§3.2) | `QualityCheck.kind` | `deterministic` / `semantic` / `hybrid` | rubric authors, UI |
| Verdict provenance (§3.3) | `evaluation_method` | `deterministic` / `deterministic_external` / `hybrid_deterministic_pass` / `hybrid_semantic` / `semantic` | verdict ledger, dashboards, audit |

The dispatcher (§3.3) is the only layer that has to translate between them. A `QualityCheck.kind = 'deterministic'` may resolve to a `Validator.kind` of either `deterministic` or `deterministic_external` depending on the validator the slug points at; the resulting verdict's `evaluation_method` records the actual path taken.

### 3.2 Quality check classification (deterministic / semantic / hybrid)

The `quality_checks` JSONB column on `scorecards` gains a new field per check. Migration adds the field with a default of `'semantic'` so existing rubrics keep working unchanged.

```typescript
interface QualityCheck {
  slug: string;
  name: string;
  passMark: number;
  enabled: boolean;
  // new fields:
  kind: 'deterministic' | 'semantic' | 'hybrid';
  validatorSlug?: string;          // required if kind === 'deterministic' or 'hybrid'
  validatorParameters?: Record<string, unknown>; // passed to the validator at runtime
  safetyClass?: boolean;           // true = zero-tolerance regression in staged rollout
}
```

**Classification guidance for rubric authors:**

- **Deterministic.** The check can be expressed as a rule whose answer does not depend on judgement. Examples: "output is valid JSON matching schema X", "no PII patterns in output", "response is between 50 and 500 characters", "all cited entity IDs exist", "agent did not invoke a skill outside its allowlist". If you can write a unit test that fails the bad case, it's deterministic.
- **Semantic.** The check requires evaluating the *quality* of reasoning, prose, or judgement. Examples: "response is helpful to the user's actual need", "tone is professional but warm", "the chosen action is the right one given the context". These need the judge.
- **Hybrid.** The check has both a deterministic prerequisite and a semantic core. Example: "response is helpful and under 500 chars" — the length is deterministic, the helpfulness needs the judge. The hybrid form runs the deterministic gate first; if length is over 500, the check fails immediately and the judge is not called.

**Default when uncertain: semantic.** Same as today's behaviour. Reclassification to deterministic or hybrid is opt-in by the rubric author, not forced by migration.

**Safety class.** New flag, orthogonal to kind. Marks checks where any regression is unacceptable (PII leak, jailbreak compliance, action-policy violation). Used by the staged-rollout pipeline (separate brief) for hard-stop gating; called out here because the validator catalogue should explicitly tag the safety-class validators.

### 3.3 Execution order and verdict composition

The judge job (`scorecardJudgeJob.ts`) gains a dispatcher at the top of every quality-check evaluation. The dispatcher reads the `kind` field and routes:

| Kind | Behaviour |
|---|---|
| `deterministic` | Look up the validator from the catalogue, evaluate it, write verdict to `scorecard_judgements`. **No LLM call.** |
| `deterministic_external` | Same, but with timeout (default 5s) and one retry. If both attempts fail, verdict is `inconclusive` with reasoning describing the external dependency. |
| `hybrid` | Run the deterministic precondition first. If it fails, write verdict immediately (failed). If it passes, fall through to the semantic judge as today. |
| `semantic` | Same as today: invoke Haiku judge, write verdict. |

**Verdict composition.** Verdicts from deterministic validators look exactly like judge verdicts in the `scorecard_judgements` table: same columns, same shape. Two columns are added to capture provenance:

- `evaluation_method` enum: `'deterministic'` / `'deterministic_external'` / `'hybrid_deterministic_pass'` / `'hybrid_semantic'` / `'semantic'`. Records which path produced the verdict.
- `validator_slug` text nullable: which validator (if any) produced this verdict.

This means the morning review queue, the trend dashboards, the bench, and any downstream consumer of `scorecard_judgements` see deterministic and semantic verdicts uniformly. They can opt to filter or distinguish by `evaluation_method` if they want.

**Hybrid composition rule.** When a hybrid check's precondition passes and the semantic judge runs, only one verdict is persisted (the semantic one), with `evaluation_method = 'hybrid_semantic'`. The precondition outcome is captured in the `evidence` field of the verdict for audit. We do not persist two verdicts per check.

**Failure-mode of the dispatcher itself.** If the validator catalogue cannot find the named slug (typo, deleted validator, version mismatch), the dispatcher logs the error, writes a verdict of `inconclusive` with reasoning describing the catalogue miss, and **does not silently fall back to the semantic judge**. Falling back would hide rubric drift; making it inconclusive surfaces it.

**Coexistence invariant with the closed-loop brief.** The closed-loop brief (`tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md` line 726) states: "deterministic validators are authoritative where available; semantic judges may supplement but not override deterministic failures." This brief honours that invariant via two structural choices, not by a runtime precedence rule:

1. **One kind per check.** A `QualityCheck` carries exactly one `kind`. The rubric editor rejects rubrics that name two checks with the same `slug` differing in kind. Two checks sharing a slug is a rubric-author error, not a runtime resolution problem.
2. **Hybrid is the only path where both fire on the same check.** Inside a hybrid check, the deterministic gate is authoritative for `fail`: if the gate fails, the semantic judge is skipped and the verdict is `failed` with the gate's evidence. The semantic judge can only refine a verdict from `inconclusive` to `pass`, never override a deterministic `fail`. This makes "deterministic wins for pass/fail" structurally true rather than enforced by an at-write precedence check.

Cross-check overlap (two separate checks evaluating the same dimension, one deterministic and one semantic) is allowed but produces two independent verdicts — composite scoring across them lives in the composite-quality-dashboard brief, not here.

**Idempotency posture for verdict writes.** Verdicts are written by the dispatcher and inherit today's `scorecard_judgements` uniqueness contract: one row per `(judgement_run_id, check_slug)`. Posture is **state-based** — `INSERT ... ON CONFLICT DO NOTHING` keyed on `(judgement_run_id, check_slug)`. A re-invocation of the dispatcher for a check that already has a verdict is a no-op; the existing verdict wins. Retry of `deterministic_external` validators happens *before* the verdict write (§3.3 retry clause), so the retry never produces a duplicate row. Spec must pin the exact unique index name when it lands.

### 3.4 Validator authoring framework

A new validator is authored by writing a TypeScript file in `server/lib/scorecardValidators/<slug>.ts` plus a co-located unit test. The framework provides:

**Author scaffolding.** A small CLI (`npm run scorecard:new-validator <slug>`) generates the validator skeleton, the test skeleton, and the catalogue registration entry. This is the same shape as how skill handlers are added today.

**Catalogue registration.** Validators self-register via a registry pattern (similar to `SKILL_HANDLERS` in `skillExecutor.ts`): `server/lib/scorecardValidators/registry.ts` imports each validator and exposes a typed lookup by slug.

**Test discipline.** Each validator must ship with:
- A passing-case test (input that should pass).
- A failing-case test (input that should fail).
- An edge-case test (the specific reason this validator exists, e.g. a known prior gaming attempt or a known false-positive).

These tests run in CI and are required for the validator to be marked `enabled`. The dispatcher refuses to call validators whose tests are red.

**Documentation requirement.** Every validator includes a brief markdown doc (in the same directory) describing what it checks, what it does not check, what its known false-positive and false-negative cases are, and which gaming attempts it is designed to defeat. This is small but compounds — the morning review queue can surface this doc when an operator clicks into a verdict.

### 3.5 Built-in validator catalogue (Phase 1 set)

These ten validators ship with Phase 1. They cover the most common quality-check patterns we already see expressed semantically and convert each to deterministic or hybrid form. List is intentionally small to start; more validators are added as rubric authors find new patterns.

| Slug | Kind | What it checks |
|---|---|---|
| `output_schema_valid` | deterministic | Output parses to a JSON Schema 2020-12 supplied via parameters. |
| `output_length_within_bounds` | deterministic | Character or token count between min and max parameters. |
| `output_non_empty` | deterministic | Output is not the empty string after trimming whitespace. |
| `no_forbidden_phrase` | deterministic | None of the parameter-supplied phrases or regexes match. Used for safety, brand voice, exclusion lists. |
| `pii_pattern_absent` | deterministic | None of a curated set of PII patterns (email, phone, credit card, TFN, SSN-shape) match. Acknowledged imperfect; defense-in-depth, not sole defence. Tagged `safetyClass: true`. |
| `cited_entity_exists` | deterministic_external | Every entity ID referenced in the output exists in the relevant subaccount table. Parameters: `{ entityTypes: Array<{ matchPattern: string; lookupService: string; idArgName: string }> }` — `matchPattern` is a regex extracting candidate IDs from the output (e.g. `/customer_([A-Z0-9]+)/g`), `lookupService` names a service method on the entity-resolver registry (e.g. `customerService.existsById`), `idArgName` is the argument name passed to that service. Lookup goes through the service layer so subaccount scoping is enforced by the same code paths every other read uses (no direct table queries from the validator). Single batched call per entity type per invocation. |
| `action_set_within_allowlist` | deterministic | Every skill the agent invoked during the run is in the parameter-supplied allowlist. Inspects `agent_runs` step lineage. |
| `numeric_within_tolerance` | deterministic | Extracts a named numeric field from output and checks it is between min and max. |
| `date_in_format` | deterministic | Extracts a named date field and checks it parses to ISO 8601. |
| `output_helpful` (hybrid) | hybrid | Precondition: `output_non_empty` + `output_length_within_bounds` (50-2000 chars). If pass, semantic judge evaluates helpfulness. Pattern: every helpfulness check should be hybrid. |

Each ships with the unit test discipline from §3.4. The PII validator and the action-allowlist validator are tagged `safetyClass: true`.

**Conversion of existing rubrics.** Phase 1 does not auto-migrate existing semantic checks to deterministic form. Migration is opt-in per rubric author. The brief recommends a sweep after Phase 1 lands: review the top 20 rubrics by run volume, identify deterministic-eligible checks, convert them, measure cost and latency reduction.

### 3.6 Versioning, audit, and observability

**Validator versioning.** Each validator carries a `version: string` field. New `validator_versions` table parallels `skill_versions`: immutable snapshots of validator code at each save, with a version number. Verdicts persist `validator_version` alongside `validator_slug` so an audit can reproduce exactly which logic produced a verdict.

**Audit ledger.** Every dispatcher invocation writes to a new append-only `validator_invocations` table:
- `verdict_id` (FK to `scorecard_judgements`)
- `validator_slug`, `validator_version`
- `evaluation_method`
- `latency_ms`, `external_call_count` (for `deterministic_external`)
- `result_passed`, `result_score`, `evidence_json`

This becomes the source of truth for cost-savings analysis (how many semantic-judge calls did we avoid this week) and for validator quality analysis (which validators have the highest false-positive rate per operator-correction signal).

**Cost attribution.** Each verdict in `scorecard_judgements` already records cost. Deterministic verdicts record `cost = 0` so the trend dashboards (closed-loop brief and the composite quality dashboard brief) can clearly show the cost reduction over time.

**Observability.** Standard `gen_ai.*` OpenTelemetry attributes for the semantic path; new `synthetos.validator.*` attributes for the deterministic path (slug, version, latency, evidence). The trace span includes both whenever a hybrid runs.

**RLS posture for the new tables.** Both `validator_versions` and `validator_invocations` are **system-tier** (no `organisation_id`, no `subaccount_id`). They are the catalogue and the audit ledger of a Synthetos-owned subsystem; tenant rows have no meaning here. Canonical opt-out reasoning per `docs/spec-authoring-checklist.md §4`:

- `validator_versions` is a code-shaped reference table parallelling `skill_versions`; rows describe globally-scoped validator implementations, not tenant data. No RLS policy; access is route-guarded by Synthetos-staff role.
- `validator_invocations` is an append-only audit row per dispatcher call. It references a `verdict_id` in `scorecard_judgements` — which IS tenant-scoped — but the invocation row itself contains no tenant payload beyond that FK. Access is route-guarded by Synthetos-staff role; tenant reads go via the parent verdict.

Spec must add both tables to `server/config/rlsProtectedTables.ts` as explicit opt-outs (system-tier, with the one-line reason). This mirrors `llm_requests` and other system-tier tables.

**Verdict-row provenance columns** (added to the tenant-scoped `scorecard_judgements`): `evaluation_method`, `validator_slug`, `validator_version`. These inherit `scorecard_judgements`' existing RLS posture unchanged.

### 3.7 UI surfaces

The brief originally implied this was a backend-only feature. It is not. Two existing UI surfaces must change for Phase 1 to be usable, and one new surface is defer-eligible.

**Surface 1 — Rubric quality-check editor (load-bearing).** Today's authoring lives at `client/src/pages/govern/ScorecardCreatePage.tsx` and exposes `slug`, `name`, `description`, `passMarkPercent`, `enabled` per check. The new fields from §3.2 (`kind`, `validatorSlug`, `validatorParameters`, `safetyClass`) need editor exposure or rubric authors can't adopt the new layer. Design decisions for the spec:

- `kind` selector with three options: deterministic, semantic, hybrid. Default `semantic` (preserves today's behaviour for existing rubrics).
- When `kind = deterministic` or `hybrid`: a `validatorSlug` dropdown sourced from the catalogue registry, plus a parameter form whose schema is the validator's parameter contract.
- When `kind = hybrid`: the form is two-step — pick precondition validator + parameters, then write the semantic prompt as today.
- `safetyClass` toggle, with helper text explaining the staged-rollout zero-tolerance semantics.
- The same edits land in `client/src/pages/agents/AgentEditScorecardTab.tsx` and `client/src/pages/agents/AgentCreateScorecardSection.tsx` (agent-attached scorecard edit paths), and in the library tab at `client/src/pages/govern/ScorecardLibraryTab.tsx`.

**Surface 2 — Verdict drill-in (load-bearing).** Per §7.4: "an operator cannot tell from the verdict shape which path produced it (which is correct), but can drill in to see the validator slug and reasoning." Trust in the deterministic layer depends on this surface existing. Drill-in must show:

- `evaluation_method` badge (deterministic / hybrid / semantic / inconclusive).
- `validator_slug` and `validator_version` when present.
- Structured `evidence` rendered as a key/value table (not pretty-printed JSON).
- For hybrid verdicts: both the gate's evidence and the semantic judge's reasoning, in that order.
- For `inconclusive` catalogue-miss verdicts: a clear "this rubric references a validator that no longer exists" callout.

Surface location: the morning review queue's per-verdict expansion panel (specified in the closed-loop brief). If that surface lands after this brief, this brief ships the verdict-drill-in component as a reusable React component and the closed-loop brief consumes it; if the closed-loop brief lands first, this brief retrofits its component into the morning review queue. Order is determined at Phase 2 entry.

**Surface 3 — Validator catalogue browser (defer-eligible).** A read-only admin index of the ten Phase 1 validators showing kind, safety-class badge, test status, doc link. Useful for discovery; not load-bearing because the CLI scaffolding (§3.4) and code review cover the authoring side. Recommend Phase 2 if a Synthetos-staff operator asks for it; do not ship in Phase 1.

**Mockups.** This brief is the first to surface UI implications; the spec phase will commission hi-fi prototypes for surfaces 1 and 2 (single-file `prototypes/deterministic-validators.html` with two screens is sufficient). Surface 3 does not need a mockup if it's deferred.

## 4. What is explicitly out of scope (Phase 1)

- **Auto-conversion of existing semantic checks to deterministic.** Migration is manual and opt-in per rubric author. Auto-conversion would invent rules that may not hold.
- **Validator generation from natural-language descriptions.** No LLM-generates-validator pipeline. Validators are written by humans, code-reviewed, tested. The whole point of the deterministic layer is that it is built by hand to a specification.
- **Validator marketplace or community sharing.** Phase 1 is internal to the Synthetos catalogue.
- **Per-org or per-subaccount custom validators.** The catalogue is system-tier only in Phase 1. Tenant-specific validators are a separate decision (similar to the amendment vs fork question in the closed-loop brief).
- **Static analysis of skill outputs at authoring time.** Validators run at evaluation time against runs, not at authoring time against skills. Pre-deployment validation of skill changes is in scope of the staged-rollout brief, not this one.
- **Replacing the LLM judge for any case where genuine reasoning is required.** Helpfulness, tone, factual grounding remain semantic. The brief's goal is to reduce the surface area, not eliminate the judge.

## 5. Sequencing inside Phase 1

**Step 1.** Schema: add `kind`, `validatorSlug`, `validatorParameters`, `safetyClass` to the `quality_checks` JSONB shape. Add `evaluation_method`, `validator_slug`, `validator_version` columns to `scorecard_judgements`. Create `validator_versions` and `validator_invocations` tables. Migration only; no behaviour change yet because all existing checks default to `kind = 'semantic'`.

**Step 2.** Validator framework: create `server/lib/scorecardValidators/` directory, the registry pattern, the TypeScript contract, the CLI scaffolding (`npm run scorecard:new-validator <slug>`), and the test discipline. No validators authored yet beyond a single canonical example for testing.

**Step 3.** Dispatcher in `scorecardJudgeJob.ts`: read `kind`, route to validator catalogue or to existing semantic judge path. Verdict composition with `evaluation_method` recorded. Dispatcher refuses to call validators with red tests or unknown slugs (writes `inconclusive` instead of falling back).

**Step 4.** Author the Phase 1 catalogue of ten validators (§3.5), with co-located tests and markdown docs. Each tagged with safety class where relevant. Each enabled in the registry only after tests pass.

**Step 5.** Audit and observability: `validator_invocations` writes, OpenTelemetry attributes, cost attribution updates so deterministic verdicts cost zero in the trend dashboards.

**Step 6.** UI surfaces 1 and 2 (§3.7): extend the rubric quality-check editor (`ScorecardCreatePage`, `AgentEditScorecardTab`, `AgentCreateScorecardSection`, `ScorecardLibraryTab`) with the four new fields; ship the verdict-drill-in component. Mockups for both screens are produced ahead of this step. Surface 3 (catalogue browser) stays deferred.

**Step 7.** Pilot: convert two existing high-volume rubrics (one for a system skill, one for a custom subaccount skill) to use the new validators. Measure cost, latency, and verdict agreement vs the previous semantic-only rubric over two weeks. Document outcome.

**Step 8.** Documentation and rollout guidance: a one-page rubric author guide explaining when to use deterministic vs hybrid vs semantic, with worked examples drawn from the pilot.

Estimated rough size: 5 to 7 weeks of focused build for one engineer (one extra week vs pre-2026-05-18 estimate to cover the UI surfaces), plus the two-week pilot observation window. Not on the critical path; runs alongside the closed-loop work.

## 6. Open questions for the dev session

1. **Dispatcher fallback behaviour on validator catalogue miss.** Brief recommends inconclusive (no silent fallback to semantic). Confirm this; alternative is a configurable per-rubric flag.
2. **Hybrid precondition failure semantics.** When a hybrid's deterministic gate fails, does the verdict score reflect the gate's score (e.g. 0.0) or the gate's evidence? Recommend score = 0.0, reasoning = "deterministic gate <slug> failed: <reason>", evidence = full gate result.
3. **Cost of `deterministic_external` validators.** They cost nothing in LLM tokens but they cost in DB queries and timeouts. How do we surface this in the cost dashboards? Recommend: track external call count and median latency separately; flag any validator whose p95 exceeds 1 second for review.
4. **Versioning granularity.** Per-file validator versions or one catalogue version? Recommend per-file (independent evolution, like skill versions today).
5. **Migration of existing rubrics.** Manual opt-in is in scope. Should we also offer a "suggest deterministic conversions" tool that scans existing semantic rubrics and proposes validators? Recommend: yes, but as a Phase 2 follow-up. Phase 1 is the substrate.
6. **Validator authoring permissions.** Who can write a new validator? Recommend Synthetos staff only in Phase 1; org-tier and subaccount-tier are deferred along with the per-tier amendment work.
7. **PII validator coverage.** The Phase 1 PII validator uses regex patterns. Real PII detection is a much harder problem. Recommend: ship the pattern-based validator with explicit caveat in its doc that it is defence-in-depth, not the sole defence.
8. **Verdict-drill-in surface ownership.** The drill-in component (§3.7 Surface 2) is consumed by the closed-loop morning review queue. If that queue lands first, this brief retrofits. If this brief lands first, it ships the component and the closed-loop brief consumes it. Phase 2 coordinator decides based on actual landing order; spec must declare the component's public API regardless of order.
9. **Hybrid editor UX for parameter forms.** The rubric editor needs to render a parameter form per validator. Two options: (a) JSON Schema → form generator (uniform, but verbose for simple validators); (b) per-validator hand-authored React fragments (cleaner UX, more code). Recommend (a) for Phase 1 with a path to per-validator overrides later; spec to pin.

## 7. Success criteria

Build is successful when:

1. The Phase 1 catalogue of ten validators is shipped with green tests, markdown docs, and registry registration.
2. The dispatcher correctly routes deterministic, hybrid, and semantic checks. Verdicts persist with `evaluation_method` distinguishing them.
3. The two pilot rubrics show a measurable cost reduction (target: at least 40% reduction in semantic judge calls on the converted checks) without verdict-disagreement degradation against the prior semantic-only baseline.
4. The morning review queue (closed-loop brief) shows deterministic verdicts with their structured evidence in the same UI as semantic verdicts; an operator cannot tell from the verdict shape which path produced it (which is correct), but can drill in to see the validator slug and reasoning.
5. The cost dashboards show the cost-saved trend over time as more rubrics adopt deterministic checks.
6. No deterministic validator has been observed producing a verdict that contradicts its own unit tests. (If this happens, the validator's code or tests are wrong; this is a regression we want to catch immediately.)
7. Rubric authors can configure deterministic, semantic, and hybrid checks entirely through the rubric editor UI (Surface 1 in §3.7) — no direct DB or JSON-config edits required.
8. The verdict drill-in (Surface 2 in §3.7) exposes `evaluation_method`, `validator_slug`, `validator_version`, and structured `evidence` for every verdict, with the inconclusive catalogue-miss case clearly distinguished.

## 8. Known failure modes we are designing against

(All anchored to public sources from the closed-loop research synthesis.)

- **Judge gaming (Dropbox-style overfit).** Optimiser writes amendments that copy example artefacts into the prompt to boost the judge score. *Mitigation:* deterministic validators cannot be gamed; converting overfit-prone checks (anything that looks like "extract field X correctly") to deterministic form removes the attack surface.
- **Reflexion task redefinition.** Optimiser rewrites the task to match what the judge will accept. *Mitigation:* deterministic schemas and entity-existence checks anchor the task; the model cannot redefine "the cited customer must exist in the database."
- **Meta-Rewarding score inflation.** Judge scores drift upward over time as the system implicitly trains the judge. *Mitigation:* deterministic scores never drift. The composition of deterministic + semantic verdicts surfaces inflation by showing it only on the semantic dimension.
- **GEPA prompt bloat.** Amendments grow past length thresholds without delivering quality gains. *Mitigation:* `output_length_within_bounds` is a Phase 1 deterministic validator; it stops bloat at the verdict layer regardless of what the proposer tries.
- **Slow drift via accumulated hybrid passes.** Hybrid checks where the deterministic gate is loose and the semantic judge is permissive can drift. *Mitigation:* the hybrid composition rule persists only the semantic verdict, but the audit ledger records the gate's evidence; trend analysis can spot gates that are passing too often relative to baseline.
- **Catalogue drift.** A validator gets renamed, deleted, or its semantics change. *Mitigation:* validator versioning + the dispatcher's no-fallback rule on catalogue miss surface drift as inconclusive verdicts immediately rather than silently.
- **External-validator unreliability.** A `deterministic_external` validator that depends on a flaky DB query becomes noise. *Mitigation:* timeout + one retry + flagged-for-review p95 latency threshold.

## 9. What this brief is not

Not a spec. The dev session produces the spec, including the validator framework API, the migration plan, and the pilot test plan.

Not a replacement for the LLM judge. Semantic checks are still essential and the brief is explicit that helpfulness, tone, and factual grounding remain semantic. The goal is to reduce the surface area where judging is the only signal, not to eliminate judging.

Not a marketing pitch. External framing, when it happens, is "Synthetos quality scoring uses deterministic rules where possible and LLM judgement where genuinely needed, with full audit of which path produced each verdict." Never "we replaced LLMs with rules" or "we have AI-powered quality assurance."

Not independent of the closed-loop work. The brief assumes the closed-loop morning review queue, regression test set, and amendment proposer exist. It is the structural defence layer that makes the closed-loop loop trustworthy.
