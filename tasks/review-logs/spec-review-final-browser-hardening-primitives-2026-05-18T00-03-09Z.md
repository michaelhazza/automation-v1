# Spec Review Final Report

**Spec:** `tasks/builds/browser-hardening-primitives/spec.md`
**Spec commit at start:** untracked (newly authored 2026-05-18; repo HEAD 0eed72e0)
**Spec commit at finish:** 871f92d144e73c2877550bc53cecf1ac7e73bc89
**Spec-context commit:** docs/spec-context.md (last_reviewed_at: 2026-05-11, green; not modified this run)
**Iterations run:** 4 of 5 (MAX_ITERATIONS)
**Exit condition:** two-consecutive-mechanical-only (iter 3 and iter 4 both had 0 directional / 0 ambiguous / 0 reclassified)
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 12 | 3 | 15 | 0 | 0 | 0 | none |
| 2 | 10 | 2 | 11 | 0 | 0 | 0 | 1 (BHP-1 proxy-config UI scope) |
| 3 | 4 | 0 | 4 | 0 | 0 | 0 | none |
| 4 | 4 | 0 | 4 | 0 | 0 | 0 | none |
| **Total** | **30** | **5** | **34** | **0** | **0** | **0** | **1** |

---

## Mechanical changes applied (grouped by spec section)

### Frontmatter
- `Status:` draft → reviewing
- `Last updated:` bumped per iteration

### §1 Goals
- humanize: removed stale "per-action and session-level opt-in"; clarified workflow-level opt-in
- Four-bucket policy: clarified off = null (not a string value)

### §4.1 Phase 1 — Detection harness
- "blocks merge on regression" replaced with "blocking-capable from day one but ships in advisory mode initially; flips to blocking per site after two consecutive nightly runs show stable baseline"

### §4.2 Phase 2 outputs
- `--timezone` removed from Chromium launch flags
- Pinned `newContext({ timezoneId, locale, extraHTTPHeaders: { 'Accept-Language': language } })` as the alignment surface

### §4.3 Phase 3 outputs
- `HumanizeProfile` narrowed to `'light' | 'balanced' | 'heavy'`
- Added `PersistedHumanize = HumanizeOptions | null` shape
- Humanize persistence description rewritten with §5.2 architect-pick conditional

### §5.1 New files
- Added three pure-function test files (humanizeInputsPure.test.ts, proxyAlignmentServicePure.test.ts, harnessHistoryWriterPure.test.ts)
- Moved `server/db/schema/harnessRunHistory.ts` from Modified to New files
- HumanizeToggle.tsx path canonicalised to `client/src/components/HumanizeToggle.tsx`
- CI workflow YAML row: added Playwright-bump path-filter trigger + explicit baseline-weakening gate pre-step invocation

### §5.2 Modified files
- Replaced `server/db/schema/workflows.ts` reference with three architect-pick options (per-template column / per-run column / code-level field)
- Added `client/src/pages/WorkflowStudioPage.tsx` row
- Rewrote proxy-settings UI row to acknowledge the codebase has no proxy-config UI at spec authoring time

### §5.3 Migrations
- humanize migration marked conditional on §5.2 architect-pick path
- CHECK constraint rewritten to enforce nullable JSONB with `light|balanced|heavy` profile and required seed

### §6.1 ProxyAlignment contract
- Added Tenant-config source surface subsection documenting that proxyConfig / workflow.locale / workflow.timezone / subaccount.language do not exist in the codebase at spec time; architect picks at Phase 2 (Q10)

### §6.2 HumanizeOptions contract
- Nullability semantics rewritten: `'off'` removed from non-null shape; "absence (null) = off" pinned
- Envelope-null trigger rewritten to be architect-pick-path-agnostic

### §6.4 Source-of-truth precedence
- DB-precedence clarified as pre-dispatch-layer only; sandbox is immutable transport
- CI status changed from "computed FROM `harness_run_history` row" to "computed from in-memory `HarnessRunResult` set"
- Workflow humanize source-of-truth made architect-pick-path-agnostic

### §7.2 RLS posture
- Rewritten to cover all three architect-pick paths (column inheritance for paths a/b; not-tenant-data for path c)

### §8.1 Detection harness execution model
- Exit-code contract pinned with three explicit conditions (gating-flag on + site mode `'blocking'` + outcome `'fail'` + CLI mode `blocking`)
- harnessHistoryWriter idempotency reframed as append-only telemetry, not a CI gate

### §8.3 humanize execution model
- Persistence read rewritten with architect-pick conditional
- "non-`off`" replaced with "non-null"

### §8.4 GeoLite2 refresh
- Queue / singletonKey / singletonMinutes / worker concurrency pinned (`queue: 'geoip-db-refresh'`, `singletonKey: 'geoip-db-refresh-active'`, `singletonMinutes: 60`, concurrency `1`)

### §9 Phase sequencing
- Phase 2 and Phase 3 dependency lines updated: "depends on Phase 1 harness being e2b-backed"
- Phase 3 humanize: replaced "extends workflows schema" with architect-pick-path-conditional line

### §10.1 Idempotency posture
- harnessHistoryWriter posture: append-only, non-idempotent intentional, telemetry-only
- humanize persistence-write posture: per architect-pick path (a/b/c)

### §10.3 Concurrency guard
- GeoLite2 swap: pg-boss singleton-key + windowed semantics replace "identical content" claim

### §10.4 Terminal event guarantee
- Detection harness outcome: aligned with §6.3 closed enum (pass / fail / baseline_established / site_unavailable / parse_error); removed stale "partial" status
- humanize action: rewritten with post-completion semantics (durationMs is meaningful); wrapper-error fallback emits `skipped` with `reason: 'wrapper_error'`

### §10.6 Unique-constraint-to-HTTP mapping
- humanize CHECK constraint surfacing made conditional on architect-pick path

### §11.2 Static gates
- Baseline-weakening gate row notes CI wiring per §5.1

### §15 Tenant-facing UI surfaces
- HumanizeToggle placement clarified (rendered from WorkflowStudioPage Advanced expander; conditional on §5.2 path)
- Seed lifecycle pinned: save/update server route assigns; dispatch only reads
- Dropped stale "surfaced on run record" claim

### §16 Deferred items
- Sandboxed test runner fallback: Phase 2/3 acceptance now explicitly contingent on real-e2b nightly when per-PR is cached-only

### §17 Open questions for architect
- Q8 added: tenant proxy-config UI surface scope (linked to BHP-1 in tasks/todo.md)
- Q9 added: humanize persistence target (a/b/c)
- Q10 added: proxyConfig + locale/timezone overrides data source

### §18 Self-consistency pass result
- Numeric reconciliation updated: 23 new files, 11 modified-file rows, 2 conditional migrations, 10 telemetry events, 3 profile names, 5 outcome enum values, 3 phases, 3 feature flags, 10 open questions

### §19.1 Detection harness acceptance
- Per-PR job framing: "blocking-capable, initially advisory"
- DB-persistence noted as best-effort (does not break CI per §6.4)
- Regression-test acceptance conditioned on advisory→blocking flip per §13

### §19.2 Proxy alignment acceptance
- Reworded from `--timezone=America/New_York` launch flag to `newContext({ timezoneId, locale, extraHTTPHeaders })` semantics

### §19.3 humanize acceptance
- Pure-module per-action p99 acceptance kept as gating
- Workflow-level +30% p95 latency reframed as non-gating manual advisory per framing

### §20 Migration / cross-cutting notes
- humanize migration note made conditional on architect-pick path
- KNOWLEDGE.md removed from doc-sync surfaces list (per codebase convention)

---

## Rejected findings

None. All 30 Codex findings and 5 rubric findings were accepted as mechanical or routed to AUTO-DECIDED. Zero false-positive rejections.

---

## Directional and ambiguous findings (autonomously decided)

| Iter | Finding | Classification | Decision | Rationale |
|---|---|---|---|---|
| 2 | Codex #4 — proxy settings UI architect-locates but no proxy-config UI exists in repo | ambiguous | AUTO-DECIDED (accept architect-locates pattern; document the scope ambiguity) | Scope question the operator already gave the architect discretion on (intent.md grill did not lock tenant-facing proxy-config UI). Mechanical fix routes the open question to architect Q8 in §17 and BHP-1 in tasks/todo.md so the architect addresses at Phase 2 chunk authoring. Not blocking. |

One AUTO-DECIDED item lives in `tasks/todo.md` under "Deferred from spec-reviewer — browser-hardening-primitives (2026-05-18)" as **BHP-1**.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across four iterations. The spec-context staleness check was green (last_reviewed_at 2026-05-11, 7 days old). All structural contradictions, file-inventory drift, schema-target ambiguities, vocabulary inconsistencies, idempotency / concurrency / terminal-event gaps, CI-exit-code rules, and pg-boss singleton-spec details have been pinned.

However:

- The review did not re-verify the framing assumptions in §3. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read §3 Framing assumptions yourself before calling the spec implementation-ready. The harness-as-runtime-test-of-external-surface departure from `e2e_tests_of_own_app: none_for_now` is flagged in §11.3 — the operator already approved this departure but should re-verify the framing matches current intent.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and the architect-pick decisions in §17 (Q1–Q10) are still the human/architect's job. In particular, Q3 (per-PR site subset), Q8 (proxy-config UI surface), Q9 (humanize persistence path), and Q10 (proxyConfig source) are load-bearing architect decisions that cascade through §5, §6, §7, and §15.
- One open scope question (proxy-config UI / proxyConfig source) was routed autonomously to the architect at Phase 2 chunk authoring. The spec is buildable in any of the three architect-pick configurations; the operator can verify this is acceptable or override before the architect runs.

**Recommended next step:** read §3 Framing assumptions and §17 Open questions for architect (now 10 items, including the three added by this review) one more time, confirm the open questions are intended to be architect-pick rather than operator-pick, and then proceed to `architect: implement browser-hardening-primitives`.
