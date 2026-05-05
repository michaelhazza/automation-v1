# ChatGPT Spec Review Session — audit-remediation-followups — 2026-04-26T00-57-02Z

## Session Info
- Spec: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
- Branch: claude/deferred-quality-fixes-ZKgVV
- PR: #201 — https://github.com/michaelhazza/automation-v1/pull/201
- Started: 2026-04-26T00:57:02Z

---

## Round 1 — 2026-04-26T00-57-02Z

### ChatGPT Feedback (raw)

Executive summary

This is a strong, execution-ready backlog spec. It's structured correctly, scoped tightly, and already reflects multiple review passes. There are no major architectural flaws.

The only real risks now are over-enforcement via gates, migration blast radius (A1), and scope creep via "defensive systems" (A2, H1) if not staged carefully.

Below is targeted feedback to de-risk execution and tighten a few edges before you treat this as final.

What's solid (don't change)
- Clear grouping (A–H) and sequencing. This reads like a real post-merge remediation plan, not a wishlist.
- Strong Definition of Done discipline across items.
- Consistent pattern: Source → Goal → Approach → Acceptance → Tests → Risk.
- Explicit rejection section prevents scope creep. This is rare and valuable.
- Sequencing logic is mostly correct, especially separating heavy items (A1, A2, B2).

Net: This is already at a level where an engineer can pick up any item and execute.

Where this will break in practice (and how to fix it)

1. A1 is bigger than it looks
You've labelled A1 as "3-5 days". That's optimistic.
Reality:
- 31 methods + all call sites + gate rewrite = cross-cutting API migration
- You are also introducing: new calling convention, new runtime behaviour (withPrincipalContext), new enforcement gate
Risk pattern: partial migrations, broken tests, hard-to-debug context bugs
Fix: split A1 into two phases
- A1a — Service surface change (no gate hardening): Add PrincipalContext support, keep old signatures temporarily (shim allowed briefly)
- A1b — Gate hardening + caller enforcement: Flip the gate, remove old signatures
If you don't split this, the PR will be painful and brittle.

2. A2 runtime guard is high-friction if done too early
The Proxy-based interception is clever, but:
- It introduces non-obvious behaviour in dev/test only
- It wraps critical DB primitives
- It can produce false positives during normal iteration
Risk pattern: Developers start bypassing it or adding allowlists everywhere -> system loses integrity.
Fix: stage A2 internally
- Phase 1: schema-diff gate only
- Phase 2: migration hook
- Phase 3: runtime guard (only after confidence)
Do not ship all three at once like the spec suggests.

3. Gate explosion risk (C1, C2, C3, D3, E2, H1)
You're adding a lot of gates. Individually they're good. Together they can create: noisy CI, slow iteration, engineers ignoring failures.
Red flag: Multiple gates rely on regex/static analysis with edge cases.
Fix: introduce a "gate quality rule"
Before adding any gate:
- Must have <5% false positive risk
- Must fail deterministically
- Must be fixable in <10 minutes
If a gate doesn't meet this, it should be: advisory only, or delayed.

4. B2 (jobs) will take longer than expected
This is not just adding headers. You're standardising: concurrency model, idempotency guarantees, test coverage (including race conditions).
Hidden complexity: writing reliable parallel tests, simulating race conditions, ensuring DB behaviour matches expectations.
Fix: sequence within B2 — Do NOT do all jobs at once.
Order:
1. connectorPollingSync (already closest)
2. bundleUtilizationJob
3. measureInterventionOutcomeJob
4. ruleAutoDeprecateJob
Treat each as its own mini-spec.

5. H1 is high leverage but dangerous if over-enforced
The rule is excellent. The gate is where this can go wrong.
Problem: Static detection of "derived data" is inherently fuzzy; field allowlists will drift.
Risk pattern: excessive exemptions, dev friction, gate becomes meaningless.
Fix: change enforcement model
- Keep architecture rule (mandatory)
- Keep logging helper (mandatory)
- Make the gate advisory initially
Promote to blocking only after: 2-3 weeks of stable signal, low false positives.

6. F2 is correctly constrained — keep it that way
This is one of the best parts of the spec. You explicitly: avoid introducing a new primitive, tie it to Phase-5A, allow deferral. Do not relax this. This is exactly how you prevent architectural bloat.

7. Sequencing is good, but one tweak improves flow
Current: A1 before A2/B2
Better: C1 -> E1/E2 -> B1/C4 -> A3/F1 -> H1 -> A1 -> B2 -> A2
Why: Clean signal first (tests/gates), fix small leaks, then introduce system rules (H1), then do heavy migrations. This reduces cognitive load during A1.

Subtle but important improvement — Add one meta rule to the spec
Add this to §4 or §0:
"No item may introduce a new abstraction, primitive, or system-level pattern unless explicitly stated in its Approach section."
This prevents: accidental mini-frameworks, helper sprawl, inconsistency across items.

Minor notes (quick fixes)
- C3: good catch on planner registry ambiguity. Keep the fallback. Do not over-engineer metadata.
- D2: correct to keep as decision-only. Do not let this expand into work.
- G1: scoping it to current-order replay only is the right call.
- Tracking table: excellent. Nothing to change.

Final verdict
Quality: High; Clarity: High; Execution readiness: Yes; Primary risk: Over-enforcement + migration complexity.
What I would change before finalising:
1. Split A1 into two phases
2. Stage A2 (don't ship runtime guard immediately)
3. Mark H1 gate as advisory initially
4. Add global "no new abstractions unless specified" rule
5. Slight sequencing tweak to front-load signal cleanup

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | Split A1 into A1a (service surface, no gate flip) + A1b (gate harden + caller enforce, no shims) | technical | apply | auto (apply) | high | Cross-cutting 31-method API migration with gate flip is brittle in one PR; split reduces blast radius. Internal sequencing only — no user-facing impact. |
| 2 | Update A1 effort estimate (3-5 days was optimistic) | technical | apply | auto (apply) | low | Reflects split + scope reality; planning input only, no contract change. |
| 3 | Stage A2 rollout in three named phases (schema-diff gate → migration hook → runtime guard) | technical | apply | auto (apply) | medium | Spec already mentions rolling out one piece at a time; ChatGPT's explicit phasing tightens it. Internal staging — no user-facing impact. |
| 4 | Add "gate quality rule" meta-bar (<5% FP, deterministic, <10min fixable; else advisory or delayed) | technical | apply | auto (apply) | medium | Internal CI quality discipline; aligns with rapid_evolution / static_gates_primary posture in docs/spec-context.md. No user-facing impact. |
| 5 | Sequence B2 work per-job (connectorPollingSync first, then bundleUtilizationJob, then measureInterventionOutcomeJob, then ruleAutoDeprecateJob) | technical | apply | auto (apply) | medium | Internal sequencing of implementation order within B2; lowest-risk-first approach. |
| 6 | H1 gate ships advisory initially; promote to blocking after 2-3 weeks of stable signal | technical | apply | auto (apply) | medium | Internal CI posture — gate's enforcement-mode is implementation discipline, not user contract. Architecture rule + helper remain mandatory per ChatGPT's framing. |
| 7 | Apply sequencing tweak: C1 → E1/E2 → B1/C4 → A3/F1 → H1 → A1 → B2 → A2 | technical | apply | auto (apply) | medium | Internal item ordering; front-loads signal cleanup before heavy migrations. No user-facing impact. |
| 8 | Add meta rule: "No item may introduce a new abstraction, primitive, or system-level pattern unless explicitly stated in its Approach section" to §4 or §0 | technical | apply | auto (apply) | medium | Reinforces existing prefer_existing_primitives_over_new_ones convention from docs/spec-context.md. Internal architectural discipline. |
| 9 | Affirmations (F2 stays constrained; C3 fallback OK; D2 stays decision-only; G1 current-order replay correct; tracking table good) | technical | reject | auto (reject) | low | No-op: confirmations of existing spec content. No edits required. |

### Triage notes

All 9 findings classified as `technical`. None describe user-facing copy, visible workflows, defaults users build muscle memory around, permission policies, public API contracts, or visible feature surface. The spec is an internal implementation backlog of post-merge remediation work; ChatGPT's feedback addresses internal sequencing, gate posture, and architectural discipline, all of which are internal-quality calls per the agent's triage rules.

No escalations triggered:
- No `defer` recommendations
- No contract changes with `architecture.md` or `docs/spec-context.md` that propagate cross-spec (the meta rule and H1 advisory-mode change tighten existing posture rather than redefining it)
- No `[missing-doc]` rejects (the meta rule aligns with `convention_rejections` in `docs/spec-context.md`)
- All recommendations are confident applies

Top themes (Round 1): de-risking blast radius (A1 split, A2 staging), gate-quality discipline (gate-quality bar + H1 advisory-on-first-ship), implementation-sequencing tightening (B2 per-job order, top-level §2 sequencing tweak), and architectural-bloat prevention (no-new-primitives meta rule).

### Applied (auto-applied technical)

- [auto] Split A1 into A1a (service surface, no gate hardening) + A1b (gate hardening + caller enforcement)
- [auto] Updated A1 effort estimate (split A1a: 2-3 days; A1b: 1-2 days)
- [auto] Staged A2 rollout into three named phases (schema-diff gate -> migration hook -> runtime guard) with explicit ordering and confidence gate between phases
- [auto] Added §0.1 "Gate quality bar" — every new gate must meet <5% FP, deterministic, <10min fixable; else advisory or delayed
- [auto] Added per-job ordering in B2 Approach (connectorPollingSync first -> bundleUtilizationJob -> measureInterventionOutcomeJob -> ruleAutoDeprecateJob)
- [auto] Marked H1 gate as advisory-on-first-ship; promote-to-blocking criterion documented (2-3 weeks stable signal, low FP)
- [auto] Re-sequenced §2 sequencing table: C1 -> E1/E2 -> B1/C4 -> A3/F1 -> H1 -> A1a -> A1b -> B2 -> A2 (with critical-path summary updated)
- [auto] Added §0.2 "No new primitives unless named" meta rule

### Integrity check

Integrity check: 7 issues found this round (auto: 7, escalated: 0). All mechanical forward-reference cleanups from the A1 -> A1a/A1b split:

1. §0 audit-verdict line referenced "A1, A2, C4 PARTIAL" — updated to "A1 (now split into A1a/A1b), A2, C4".
2. §0 testing-posture paragraph referenced "A1 RLS-context binding" — updated to "A1a RLS-context binding".
3. §0.2 no-new-primitives bullet referenced "A1 introduces no new primitive" — updated to "A1a / A1b introduce no new primitive".
4. B2 Dependencies referenced "A1 (Principal-context propagation)" — updated to "A1a (service surface change). A1b not required.".
5. C4 Approach branched on "A1 has shipped / has NOT shipped" — clarified to branch on A1b (the gate-flip item), since A1a alone doesn't change the gate's contract.
6. F1 Approach + Dependencies referenced A1 — updated to A1a (signature standard is established by A1a).
7. H1 Dependencies + §5 Tracking row noted "depends on B2" — corrected to reflect new §2 sequencing (H1 ships BEFORE B2 per ChatGPT review Round 1; B2 dep is stale and superseded).

Post-integrity sanity (4c): no broken links found. Old TOC anchor `a1--principal-context-propagation-import-presence-to-call-sites` is gone; new anchors `a1a--principal-context-propagation-service-surface-change-no-gate-hardening` and `a1b--principal-context-propagation-gate-hardening--caller-enforcement` are present. §4 DoD table and §5 Tracking table both reflect the A1a/A1b split with consistent row counts.

---

## Round 2 — 2026-04-26T01-30-00Z

### ChatGPT Feedback (raw)

Executive summary

This is now very close to a finalised, high-confidence execution spec. The structural risks from the previous round have been addressed properly:
- A1 split and sequenced correctly
- A2 phased with explicit confidence gates
- Gate explosion controlled via §0.1
- H1 correctly staged as advisory-first
- Sequencing now reduces cognitive load before heavy migrations

At this point, there are no architectural blockers. What remains are a handful of precision tightenings that will prevent edge-case failures and implementation drift.

What's now excellent (lock this in)
- The phasing discipline (A2, H1) is exactly right. This avoids the common "we built enforcement too early" trap.
- The Gate Quality Bar (§0.1) is strong and will save you weeks of pain later.
- The No New Primitives rule (§0.2) is doing real work. Keep it.
- B2 sequencing is now correct and realistically scoped.
- The spec is now truly executable per-item without re-interpretation.

This is the level where most teams would already start building.

Final issues to tighten before calling it "done"

1. A1b gate matcher is still fragile
Right now, the matcher relies on: regex for first-arg detection; same-file `: PrincipalContext` detection.
This will break in subtle cases: imported typed variables, destructured params, helper wrappers.
Failure mode: False negatives → unsafe calls pass; False positives → dev frustration.
Fix (small but important): Add a constraint to the spec:
"If regex-based matching proves insufficient during implementation, fallback is a minimal TypeScript AST check scoped ONLY to canonicalDataService call expressions."
Do not leave this as an implicit decision during implementation.

2. A2 runtime guard "role detection" is underspecified
This line is risky: "scan the callback for a SET LOCAL ROLE admin_role"
That is: string-based; not guaranteed to execute before write; easy to bypass accidentally.
Failure mode: false confidence in admin bypass; inconsistent enforcement.
Fix: Tighten contract — Require explicit API call, not SQL detection. Add to spec:
"Admin bypass must be declared via an explicit flag passed to `withAdminConnectionGuarded({ allowRlsBypass: true }, fn)` rather than inferred from SQL inspection."
This removes ambiguity and makes behaviour deterministic.

3. B2 concurrency tests need a deterministic harness constraint
Right now you mention: pg_sleep, repeated runs. This is good but not sufficient.
Failure mode: flaky tests; false sense of safety.
Fix: Add one rule:
"Concurrency tests must control the race window via an injected test hook (e.g. pause between claim and commit), not rely solely on timing or pg_sleep."
This ensures determinism.

4. C3 has an unresolved branch (don't leave it open)
You currently allow: "If metadata doesn't exist, reduce to 2-set comparison"
This is a spec hole.
Failure mode: C3 ships half-complete; never upgraded.
Fix: Force a decision. Add:
"If planner registry lacks `canonicalTable` metadata, C3 MUST ship as 2-set validation AND create a tracked follow-up item to add metadata before Phase 5A."
Do not leave this as optional.

5. D3 calibration logic needs a hard rule
Right now: you allow changing subtraction constant.
This is dangerous.
Failure mode: masking real mismatches.
Fix: Add:
"Calibration constant changes must list every excluded occurrence explicitly in a comment with line references."
Prevents silent drift.

6. H1 scope control (important)
H1 is high leverage, but scope can explode.
Right now: "identify all in-scope sites" — That's vague.
Failure mode: open-ended refactor; large PR; inconsistent adoption.
Fix: Constrain:
"H1 Phase 1 applies ONLY to the four job output domains (bundleUtilization, interventionOutcome, ruleAutoDeprecate, connectorPolling). Additional domains require separate backlog entries."
This keeps it surgical.

7. Add one missing global constraint
You already have: gate quality; no new primitives.
You're missing "no cross-item expansion".
Add:
"An item may not expand its scope to fix adjacent issues discovered during implementation. Such findings must be logged and handled in separate backlog items."
This prevents A1/A2/B2 turning into multi-week refactors.

Minor clarity improvements (quick wins)
- In A1a: explicitly state: "PrincipalContext must never be constructed inline except via `fromOrgId` or existing context propagation"
- In A2: clarify that Proxy wrapping must not change method signatures
- In B2: explicitly define "no-op" return semantics (log vs silent)
- In C1: specify that `[GATE]` line must be last emitted line

Final verdict
Architecture: solid
Execution clarity: high
Risk level: controlled
Remaining issues: precision, not design
Status: You can finalise this spec after one more tightening pass.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | A1b gate matcher: AST-fallback constraint required if regex FP/FN > 5% on dogfood pass | technical | apply | auto (apply) | high | Internal gate matcher implementation; fragility was a named ChatGPT review concern, AST-fallback is a deterministic remediation. No user-facing impact. |
| 2 | A2 admin-bypass declared via explicit `allowRlsBypass: true` flag, not SQL string inspection | technical | apply | auto (apply) | high | Internal API contract for the dev/test runtime guard. SQL-string detection is non-deterministic; explicit flag removes ambiguity. No production behaviour change (guard is dev/test-only). |
| 3 | B2 concurrency tests use injected `__testHooks` seam, not solely pg_sleep | technical | apply | auto (apply) | high | Internal test discipline. Flaky-test prevention; deterministic race-window control. No user-facing impact. |
| 4 | C3 forced decision: 2-set ships + tracked follow-up to upgrade to 3-set before Phase 5A | technical | apply | auto (apply) | medium | Internal sequencing; closes a spec hole that would otherwise leave C3 indefinitely half-complete. No user-facing impact. |
| 5 | D3 calibration-constant changes require explicit per-occurrence line refs in comment | technical | apply | auto (apply) | medium | Internal gate integrity; prevents silent drift in the calibration constant masking real mismatches. No user-facing impact. |
| 6 | H1 Phase 1 scope-locked to four named job output domains | technical | apply | auto (apply) | medium | Internal scope control on a refactor; prevents open-ended H1 PR. Architecture rule itself stays broad — only enforcement sweep is scope-locked. No user-facing impact. |
| 7 | Add §0.3 "No cross-item scope expansion" meta rule | technical | apply | auto (apply) | medium | Internal architectural discipline; reinforces the failure mode this spec was created to address (PR #196's blast radius). No user-facing impact. |
| 8 | A1a clarification: PrincipalContext must be obtained via fromOrgId or propagation, never inline-constructed | technical | apply | auto (apply) | low | Internal contract clarity; reinforces A1b's gate matcher discipline at every materialisation site. No user-facing impact. |
| 9 | A2 clarification: Proxy must not change method signatures (forward args / return types unchanged) | technical | apply | auto (apply) | low | Internal contract; prevents subtle behaviour drift when callers swap raw handle for guarded handle. No user-facing impact. |
| 10 | B2 clarification: no-op return semantics defined ({status, reason, jobName} + INFO log; not silent, not throw) | technical | apply | auto (apply) | medium | Internal contract; removes ambiguity that would otherwise leave "did it no-op or fail silently?" undebuggable. No user-facing impact. |
| 11 | C1 clarification: `[GATE]` line must be the LAST emitted line (CI tail -n 1 deterministic) | technical | apply | auto (apply) | low | Internal CI parser convention. No user-facing impact. |

### Triage notes

All 11 findings classified as `technical`. None describe user-facing copy, visible workflows, defaults users build muscle memory around, permission policies, public API contracts, or visible feature surface. ChatGPT's Round 2 feedback explicitly framed itself as "precision, not design" — every finding tightens an internal-quality call (gate matcher fragility, test determinism, scope locks, contract clarity) where the user has explicitly opted out of approving on quality calls.

No escalations triggered:
- No `defer` recommendations (all confident applies)
- No contract changes with `architecture.md` or `docs/spec-context.md` that propagate cross-spec — A2's architecture.md update line was already specified in Round 1 and was tightened (SQL-detection -> explicit flag) within the same line; no new cross-spec contract emerged. H1's architecture.md rule wording is unchanged in Round 2 (only the *enforcement scope* of H1 Phase 1 is locked, the rule itself stays broad).
- No `[missing-doc]` rejects — all findings align with existing posture (`prefer_existing_primitives_over_new_ones`, `static_gates_primary`, `runtime_tests: pure_function_only` carve-out).
- High confidence on every fix.

Top themes (Round 2): determinism (AST-fallback for fragile regex; explicit-flag instead of SQL inspection; injected test hooks instead of timing-only), scope control (§0.3 cross-item; H1 Phase 1 four-domain lock; C3 forced-decision), and contract clarity (no-op return shape; Proxy signature transparency; PrincipalContext construction discipline; [GATE] line terminality).

### Applied (auto-applied technical)

- [auto] §0.3 "No cross-item scope expansion" meta rule added (sibling to §0.1 Gate quality bar and §0.2 No new primitives unless named).
- [auto] A1a step 5 added — PrincipalContext-construction discipline (fromOrgId or propagation only; no inline literals or ad-hoc helpers; tests exempt).
- [auto] A1b gate matcher: regex-fallback contract added — AST-upgrade required if first-pass FP/FN rate > 5% on `main` dogfood, scoped to `canonicalDataService.<method>(` call expressions only.
- [auto] A2 admin-bypass declaration: replaced "scan callback for SET LOCAL ROLE admin_role" with explicit `withAdminConnectionGuarded({ allowRlsBypass: true|false }, fn)` flag. Updated tests, acceptance criteria, and architecture.md update wording to match.
- [auto] A2 Proxy-transparency clause added — guard MUST forward all arguments unchanged and return underlying method's return value; chained-builder semantics preserved. New test case (#6) added.
- [auto] B2 race-window control — injected `__testHooks` seam contract; pg_sleep is *additional* not primary; hook is no-op in production.
- [auto] B2 no-op return semantics — structured `{ status: 'noop', reason, jobName }` shape + INFO log line `job_noop:`; not silent, not throw. Acceptance criteria updated.
- [auto] C1 — [GATE] line is the LAST emitted line (Summary: line precedes it now); architecture.md documentation update wording adjusted; new acceptance line for `tail -n 1` test.
- [auto] C3 — forced decision: if `canonicalTable` metadata exists, ship 3-set; if not, ship 2-set AND create tracked follow-up todo to upgrade before Phase 5A. No more "either path is fine".
- [auto] D3 — calibration-constant change discipline: any change to the subtraction constant MUST list every excluded occurrence with file path + line number in a comment above the constant. Non-optional.
- [auto] H1 — Phase 1 scope-locked to four named job output domains (bundleUtilizationJob, measureInterventionOutcomeJob, ruleAutoDeprecateJob, connectorPollingSync). Architecture.md rule wording stays broad (durable policy); only Phase 1's enforcement sweep is scope-locked. Phase 1 acceptance criteria + Approach Step 1 explicitly note the rule-vs-sweep distinction.

### Integrity check

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

All Round 2 edits were precision tightenings inside existing sections — no section renames, no item splits, no new top-level headings (§0.3 is a sub-heading inside §0; the TOC does not enumerate §0 sub-headings, so no TOC update required). Cross-references touched in Round 2 (B2 step 5 references "step 3 above"; H1 step 2 references §0.3; A1a step 5 references A1b gate; A2 admin-bypass references `withAdminConnection`'s existing contract) all resolve correctly. Section/step numbering inside B2 Approach now runs 1 → 2 → 3 (with race-window control nested under step 3) → 4 (optional gate) → 5 (no-op semantics) — sequential and intact. No empty sections, no broken anchors.

Post-integrity sanity (4c): not applicable — zero mechanical fixes applied this round.

---

## Round 3 — 2026-04-26T02-00-00Z

### ChatGPT Feedback (raw)

Executive summary

This is now at production-grade spec quality. You've closed every meaningful ambiguity from previous rounds, and more importantly, you've done it without bloating the system or introducing new primitives.

At this point, there are no remaining architectural gaps. What's left are final edge-case guards and implementation traps that are easy to miss but high leverage to lock in now.

What's now genuinely strong (this is rare)
- §0.3 (no cross-item expansion) closes one of the biggest real-world failure modes
- A1b with explicit AST fallback trigger condition is exactly the right balance of pragmatism and safety
- A2 admin bypass via explicit flag instead of inference removes an entire class of silent bugs
- B2 deterministic concurrency harness via `__testHooks` is a major quality upgrade
- C3 forced decision removes spec limbo
- D3 auditability constraint prevents "calibration drift hiding real issues"
- H1 scope lock prevents uncontrolled refactor creep

This is the kind of spec that actually survives contact with implementation.

Final tightenings (true last pass)

1. A1b AST fallback trigger is still slightly ambiguous
You currently have: fallback if regex FP/FN > 5%
That's directionally correct, but:
Problem: "5%" is not measurable unless you define the sample; devs will guess or ignore it.
Tighten: Add:
"FP/FN rate is measured against a minimum sample of 50 call sites. If ≥3 confirmed misclassifications are observed, AST fallback is mandatory."
This makes the trigger concrete and enforceable.

2. A2 guard needs one protection against "flag drift"
You've added: `allowRlsBypass: true|false`. Good. But:
Failure mode: someone sets true casually; spreads over time; defeats RLS protection intent.
Add constraint:
"Any use of `allowRlsBypass: true` must include an inline comment explaining justification. CI must fail if the flag is present without a comment."
This is a very cheap but powerful control.

3. B2 "noop" semantics need one more invariant
You defined: `{ status: 'noop' }` + INFO log. Good, but incomplete.
Failure mode: partial state changes before noop return; downstream assumes no-op means no side effects.
Add:
"A noop outcome must guarantee zero writes and zero side effects. Any pre-write condition must be evaluated before mutation begins."
This makes idempotency strict, not best-effort.

4. C1 "[GATE] must be last line" needs one exception rule
Right now it's absolute.
Failure mode: logging frameworks append trailing logs (timing, cleanup); breaks the invariant unintentionally.
Add:
"No application-level logs may follow the [GATE] line. Framework-level logs are exempt."
Prevents false failures.

5. C3 follow-up tracking needs ownership
You added: tracked follow-up. But:
Failure mode: follow-up exists but is never owned; silently ignored.
Add:
"Follow-up must include an owner and a trigger condition for re-evaluation (e.g. Phase 5A entry)."

6. H1 needs one rollout safeguard
Even with scope lock, this can still bite.
Failure mode: inconsistent shapes across domains; breaks downstream consumers.
Add:
"During Phase 1, canonical output shapes must be additive only. No field removals or renames allowed."
This ensures safe rollout.

7. Missing one global invariant (important)
You've locked scope, gates, primitives. You're missing "determinism over cleverness".
Add a short rule:
"Where multiple implementation approaches exist, preference must be given to the most deterministic and inspectable option over the most concise or abstract."
This aligns decisions across A1, A2, B2, C3 implicitly.

Optional but high-value (if you want elite-level robustness)
Add a "Spec Integrity Check" mini-section. Very small, but powerful:
Before marking any item complete:
- All DoD conditions pass in CI
- No TODOs or placeholders remain in changed files
- All new invariants are observable via logs or tests
- No silent fallbacks introduced
This prevents "technically done but actually incomplete".

Final verdict
Status: Approved for finalisation and execution
Confidence level: Very high. This is now:
- Implementation-safe
- Drift-resistant
- Scalable across multiple engineers or agents
- Aligned with your system philosophy (no overengineering, high leverage)

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | A1b AST fallback trigger: define sample (50 call sites) + concrete trigger (≥3 misclassifications) | technical | apply | auto (apply) | high | Internal gate matcher implementation discipline; "5%" was unmeasurable without sample size, this is the deterministic version. Aligns with new §0.4. No user-facing impact. |
| 2 | A2 flag-drift protection: mandatory inline justification comment + CI grep check on `allowRlsBypass: true` | technical | apply | auto (apply) | high | Internal contract reinforcement; prevents copy-paste spread of a security-defeating flag. Deterministic check (comment present or not). No user-facing impact. |
| 3 | B2 zero-side-effects invariant: `{ status: 'noop' }` MUST guarantee zero writes; pre-write condition evaluated before mutation begins | technical | apply | auto (apply) | high | Internal idempotency contract; closes "best-effort no-op" failure mode where partial writes contaminate downstream readers. No user-facing impact. |
| 4 | C1 framework-log exception: `[GATE]` last-line rule applies to application-level logs only; framework logs (shell trace, tsx warnings, Node deprecations) exempt | technical | apply | auto (apply) | medium | Internal CI parser convention; absolute "last line" is brittle against framework noise. CI parser shifts to grep-then-tail form. No user-facing impact. |
| 5 | C3 follow-up: owner + trigger condition required on the `tasks/todo.md` entry | technical | apply | auto (apply) | medium | Internal backlog hygiene; prevents silent backlog rot on a deferred technical follow-up. No user-facing impact. |
| 6 | H1 Phase 1 additive-only output shapes constraint (no field removals/renames during rollout window) | technical | apply | auto (apply) | medium | Internal contract on the four in-scope job output domains; prevents silent breakage of downstream consumers during the null-safety rollout. No user-facing impact (consumers are internal services, not customers). |
| 7 | Add §0.4 "Determinism over cleverness" cross-cutting meta rule | technical | apply | auto (apply) | medium | Internal architectural discipline; codifies the meta-pattern under §0.1/§0.2/§0.3. Aligns A1b/A2/B2/C3/D3 explicitly. No user-facing impact. |
| 8 | Add §4.1 "Per-item integrity check" mini-section (4 conditions before flipping §5 Tracking row to ✓) | technical | apply | auto (apply) | medium | Internal completion discipline; prevents "technically merged but actually incomplete" failure mode. No user-facing impact. |

### Triage notes

All 8 findings classified as `technical`. None describe user-facing copy, visible workflows, defaults users build muscle memory around, permission policies, public API contracts, or visible feature surface. ChatGPT's Round 3 feedback explicitly framed itself as "final edge-case guards and implementation traps" — every finding tightens an internal-quality call (trigger thresholds, contract precision, CI parser conventions, internal completion discipline). The user has explicitly opted out of approving on quality calls of this shape per the agent's triage rules.

No escalations triggered:
- No `defer` recommendations (all confident applies).
- No contract changes with `architecture.md` or `docs/spec-context.md` that propagate cross-spec — A2's architecture.md update line gained one sentence on the `allowRlsBypass: true` justification-comment requirement, which is an extension of the same A2 contract already in flight (introduced Round 2, scoped to A2's three named files / one hook in §0.2). The C1 architecture.md update line gained the framework-log exception clarification, which is a precision tightening of an existing contract, not a new cross-spec rule. Both are internal-discipline updates inside this spec's already-named architecture.md write surface.
- No `[missing-doc]` rejects — all findings align with existing posture (`prefer_existing_primitives_over_new_ones`, `static_gates_primary`).
- High confidence on every fix.

Top themes (Round 3): determinism made measurable (concrete sample + threshold for AST fallback; framework-log exception with canonical CI parser shape; owner+trigger on follow-up entries), strict idempotency (zero-side-effects invariant on noop returns), drift prevention (flag-drift comment+CI; additive-only shape contract during H1 rollout), and meta-discipline (§0.4 determinism-over-cleverness, §4.1 per-item integrity check).

### Applied (auto-applied technical)

- [auto] A1b AST fallback trigger tightened — concrete sample (50 call sites minimum) + concrete threshold (≥3 confirmed misclassifications) replaces ambiguous ">5%". Decision logging requirements made explicit (sample list + count in build-slug progress log). Sub-50 sample case handled.
- [auto] A2 flag-drift protection added — mandatory inline justification comment requirement + CI gate check (extension of `scripts/verify-rls-protected-tables.sh`, NOT a new file; preserves §0.2 budget). A2 Phase-3 DoD updated. architecture.md update wording extended with the comment requirement. §0.2's A2 file-list line clarified that `verify-rls-protected-tables.sh` carries two checks (schema-vs-registry + flag-justification) — single file with two checks, not two files.
- [auto] B2 zero-side-effects invariant added under no-op return semantics — `{ status: 'noop' }` MUST mean zero writes; pre-write condition evaluated before mutation begins; partial-write rollback contract; regression test now asserts state-unchanged after noop.
- [auto] C1 framework-log exception added — application-level logs vs framework-level logs distinction; canonical CI parser shape changed to `grep -E '^\[GATE\] ' | tail -n 1`. Acceptance criterion + architecture.md update wording updated to match.
- [auto] C3 follow-up entry shape now requires owner + trigger condition; failure to include either fails C3 DoD. `tasks/todo.md` entry template provided.
- [auto] H1 additive-only output shapes constraint added under Approach step 3 — no field removals or renames during Phase 1 rollout window; rename/remove needs surface as a separate follow-up; constraint scope is the four in-scope job output domains.
- [auto] §0.4 "Determinism over cleverness" cross-cutting meta rule added (sibling of §0.1/§0.2/§0.3). Concrete consequences enumerated; aligns A1b/A2/B2/C3/D3 explicitly.
- [auto] §4.1 "Per-item integrity check" mini-section added (4 conditions: DoD passes in CI, no TODOs/placeholders, all invariants observable, no silent fallbacks). Gating rule added for §5 Tracking flip.

### Integrity check

Integrity check: 1 issue found this round (auto: 1, escalated: 0).

1. A2 flag-drift edit initially mentioned a potentially-new sibling gate file `scripts/verify-admin-bypass-justification.sh` ("either … or sibling") which conflicts with §0.2's "exactly three new files plus one hook" budget for A2. **Mechanical fix applied:** rewrote A2 flag-drift CI-gate paragraph to specify the check is added INSIDE the existing `scripts/verify-rls-protected-tables.sh` (one of the three already-named A2 files), and updated §0.2's A2 line to clarify "single file with two checks, not two files". Both edits keep A2 within its named-file budget per §0.2 — preferred over loosening §0.2 because §0.4's determinism-over-cleverness rule, which was the headline addition this round, would itself have flagged "two files for one concern" as the less-deterministic option.

Cross-references touched in Round 3 (§0.4 referencing §0.1/§0.2/§0.3 + A1b/A2/B2/C3/D3; §4.1 referencing §1 / §5 Tracking; A2 flag-drift referencing §0.2 file budget; A2 Phase-3 DoD referencing the new flag-drift check; H1 additive-only referencing §0.3; C1 framework-log exception referencing canonical parser shape) all resolve correctly. No empty sections, no broken anchors. Section/sub-section numbering: §0 carries §0.1-§0.4 sequential; §4 carries §4.1; both are stable. The TOC does not enumerate §0 sub-headings or §4 sub-headings, so no TOC update is required.

Post-integrity sanity (4c): the one mechanical fix above (A2 flag-drift moved inside existing gate, §0.2's A2 line clarified) was a single coupled edit-pair, not a chain of cascading changes. Verified the A2 Phase-3 DoD line that mentions the new check now matches the updated §0.2 budget — both consistent. No broken links, no left-empty sections.

---

## Round 4 — 2026-04-26T03-30-00Z

### ChatGPT Feedback (raw)

Short answer: this is already very tight. There's no obvious structural gap left. What remains are a handful of edge-case failure modes and execution risks that aren't explicitly locked down yet.

Below is only delta feedback — things worth tightening before you call this final.

1. Biggest remaining risk: A1a/A1b migration correctness drift
You've nailed the structure, but there's still one subtle failure mode:
Issue: A1a allows a temporary shim + partial migration. That creates a window where:
- Some callers use PrincipalContext
- Some still rely on the deprecated overload
- Tests pass, but coverage is incomplete
Risk: You can "think" you've migrated everything, but a few call sites silently use the shim and never get caught until A1b.
Tightening (worth adding):
Add a mandatory detection step before A1b:
"Before A1b begins, run a grep for all usages of deprecated overloads and assert count = 0."
Concretely:
- `grep -rn "@deprecated — remove in A1b" server/`
- `grep -rn "canonicalDataService\.\w+(organisationId" server/`
And make it an explicit A1b precondition.

2. A2 runtime guard: Proxy coverage completeness
You're intercepting: `.insert`, `.update`, `.delete`
Gap: There are other write paths that can bypass this:
- `.execute(sql)` raw queries
- `.transaction(...)` nested writes
- indirect writes via helper wrappers
Risk: Guard gives false confidence while some writes bypass it.
Tightening:
Add a constraint: "All service-layer writes MUST go through Drizzle builder methods (insert/update/delete) OR explicitly call `assertRlsAwareWrite`."
And optionally: Add detection in A2 gate — flag `.execute(` usage on tenant tables (advisory).

3. B2 concurrency: lock scope consistency
You define per-job strategies, which is good.
Subtle risk: Different engineers may choose: org-level lock, global lock, per-entity lock — inconsistently for similar jobs.
Outcome: Hard-to-debug production contention or under-locking.
Tightening:
Add one line to architecture rule: "Default lock scope is per-org unless the job explicitly requires global serialization."
This prevents arbitrary decisions.

4. B2 test hooks: leak into production
You handled this well, but one failure mode remains:
Risk: A developer forgets to reset or guard the test hook.
Tightening:
Require: "__testHooks must be tree-shaken or no-op in production builds AND must not alter execution if unset."
Even better: enforce `if (!__testHooks.pause) return;` pattern centrally.

5. C1 gate standard: multi-line output edge case
You enforce: `[GATE]` must be last application-level line.
Edge case: Some scripts may pipe output, call subscripts that emit after summary.
Tightening:
Add: "Subscripts MUST NOT emit output after parent emit_summary is called."
This prevents accidental violations from nested scripts.

6. C3 follow-up risk: never implemented
You added owner + trigger (good), but one more failure mode exists:
Risk: Phase 5A happens but no one links it back to C3.
Tightening:
Add: "Phase 5A spec MUST include a checklist item: 'C3 canonicalRegistryDrift test upgraded to 3-set comparison'"
This forces coupling.

7. D3 calibration constant: future fragility
You correctly require listing all exclusions.
Remaining risk: File line numbers drift over time → comment becomes stale.
Tightening:
Instead of line numbers, require: grep pattern + short description, not absolute line numbers.
Example:
- `interface ActionDefinition` (type declaration)
- `methodologyTemplate default block`
Line numbers are brittle.

8. E2 baseline handling: baseline rot
You standardised on `guard-baselines.json` which is good.
Risk: Baselines slowly increase and no one questions it.
Tightening:
Add rule: "Any increase in baseline count requires a PR note explaining why."
This keeps signal meaningful.

9. F2 deferral path: permanent deferral risk
You correctly defer if API doesn't fit.
Risk: It never gets revisited.
Tightening:
Add trigger: "Re-evaluate F2 when: second KV-with-TTL use case appears OR configDocuments route exceeds X latency threshold"
Now it's measurable.

10. H1 null-safety: over-logging risk
You standardised logging, which is great.
Risk: High-frequency paths spam logs (`data_dependency_missing`).
Tightening:
Add: "WARN logs MUST be rate-limited (once per key per interval) OR downgraded to DEBUG after first occurrence."
Otherwise logs become noise.

11. Sequencing: one optimisation
Your sequencing is solid, but one improvement:
Move: C1 even earlier (before G1/D1)
Reason: everything benefits from standard output format; makes early investigation cleaner.

12. One thing that's missing entirely (minor but valuable)
Global invariant: "No silent success on partial execution"
You enforce this in B2 (jobs), but not globally.
Suggest adding (small, high value) — In architecture.md:
"Any operation that partially executes MUST: either roll back fully, OR return structured partial-state result, OR log explicit partial execution."
This prevents hidden inconsistencies outside jobs.

Final assessment — What you've done well: Scope control is extremely strong; Phasing is disciplined; Gates are practical, not theoretical; You avoided over-engineering. What's left: Mostly edge-case enforcement; preventing drift over time; ensuring follow-ups actually happen.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | Mandatory shim-usage grep precondition before A1b begins (greps must return 0 for any deprecated-overload caller) | technical | apply | auto (apply) | high | Internal migration discipline; closes a known A1a/A1b correctness drift window. Deterministic checks (greps), explicit thresholds. No user-facing impact. |
| 2 | A2 Proxy coverage: add written contract that all service-layer writes to tenant tables go through builder methods OR call `assertRlsAwareWrite` explicitly; add advisory grep gate inside existing `verify-rls-protected-tables.sh` for `.execute(sql)` calls referencing tenant tables without `assertRlsAwareWrite` nearby | technical | apply | auto (apply) | high | Internal contract reinforcement. Closes the false-confidence gap where Proxy is on but `.execute(sql)` bypasses it. Advisory mode follows §0.1; check lives inside existing gate file (no new file, preserves §0.2 A2 budget — gate now carries 3 checks). No user-facing impact. |
| 3 | Add §0.6 architectural-default lock scope rule (per-org by default; deviation must be justified inline) + extend B2-ext architecture.md rule line | technical | apply | auto (apply) | medium | Internal architectural discipline; prevents inconsistent lock-scope choices across the four jobs. Strengthens existing posture; no contract change to other specs. No user-facing impact. |
| 4 | B2 `__testHooks` production-safety invariant (tree-shaken or no-op in prod; no execution change when unset; reset-on-import in test boundaries) + advisory grep check on unguarded `await __testHooks.` calls | technical | apply | auto (apply) | medium | Internal test discipline; prevents test-hook leakage into production execution. Three concrete mechanical conditions; canonical call-site pattern named. No user-facing impact. |
| 5 | C1 subscript-output constraint: no subscript may emit application-level output AFTER parent's `emit_summary`; gate self-test extended with deliberately-misconfigured-subscript fixture | technical | apply | auto (apply) | medium | Internal CI parser convention; closes accidental-violation path. Author-time discipline + fixture test exercises both grep-form and strict-tail-form parsers. No user-facing impact. |
| 6 | C3 Phase-5A spec coupling: the future Phase-5A spec MUST include the C3 3-set upgrade as a checklist item in its own §1; C3 implementer adds the line directly if a Phase-5A spec already exists at C3 ship time | technical | apply | auto (apply) | medium | Internal backlog-coupling discipline; closes the "follow-up exists but never gets linked" failure mode. Rule shape is concrete and verifiable. No user-facing impact. |
| 7 | D3 calibration-constant change discipline refined: use grep pattern + short description for each excluded occurrence, NOT absolute line numbers (line numbers drift) | technical | apply | auto (apply) | medium | Internal gate-stability refinement; replaces brittle line-number references with stable grep patterns. Reviewers verify exactly-one-hit per pattern at PR review time. No user-facing impact. |
| 8 | Add §0.7 baseline-rot prevention rule: any PR that increases a `scripts/guard-baselines.json` count MUST include a PR-description note explaining why; reviewers reject without the note | technical | apply | auto (apply) | medium | Internal CI quality discipline; prevents silent baseline creep across the spec's gates. Social enforcement (no automated CI check — false-positive prone). E2 acceptance criteria updated to reference §0.7. No user-facing impact. |
| 9 | F2 case (b) deferral entry MUST include explicit measurable re-evaluation triggers (second KV-with-TTL use case, OR latency >500ms median rolling 24h, OR configDocuments-domain build slug opens) — owner + trigger shape mirrors C3's | technical | apply | auto (apply) | medium | Internal backlog hygiene; prevents permanent-deferral-by-omission. Triggers are measurable. No user-facing impact (latency threshold is internal observability, not a customer-visible SLA). |
| 10 | H1 `logDataDependencyMissing` helper MUST implement rate-limiting (Pattern A: once per key per 60s interval, configurable via env var) OR DEBUG-downgrade after first occurrence (Pattern B); choice documented in helper JSDoc and architecture.md rule line | technical | apply | auto (apply) | medium | Internal observability / log-volume discipline; prevents WARN-line spam from masking signal. The WARN line itself is operator-facing internal observability, not a customer-visible communication. Both patterns specified mechanically. No user-facing impact. |
| 11 | Move C1 from sequencing position 4 to position 2 — every gate touch in this spec ships against the C1 standard from day 1, no retrofit pass | technical | apply | auto (apply) | low | Internal sequencing tweak; rationale documented in §2 sequencing block (cost: half-day already estimated; benefit: cleaner signal across remaining items). No user-facing impact. |
| 12 | Add §0.5 cross-cutting "no silent success on partial execution" rule (roll back fully, OR return structured partial-state result, OR log explicit partial execution at WARN); architecture.md rule line carries the partial-execution clause inside the B2-ext concurrency rule paragraph | technical | apply | auto (apply) | medium | Internal architectural discipline; generalises the per-item rule from B2 to a global posture. Three concrete approved patterns; rejects silent-success returns. Aligns with §4.1 per-item integrity check ("no silent fallbacks"). No user-facing impact. |

### Triage notes

All 12 findings classified as `technical`. ChatGPT's Round 4 feedback explicitly framed itself as "edge-case failure modes and execution risks that aren't explicitly locked down yet" — every finding tightens an internal-quality call (migration correctness gates, runtime guard coverage shape, lock-scope defaults, test-hook isolation, CI parser conventions, backlog coupling, calibration discipline, baseline rot, deferral triggers, observability log volume, sequencing, partial-execution rule). None describe user-facing copy, visible workflows, customer permissions, pricing, public API contracts, defaults end-users build muscle memory around, or visible feature surfaces.

Closer-look items resolved:
- **Finding 10 (H1 over-logging)** — operator log lines are internal observability, not customer-visible communication. The `data_dependency_missing` WARN line is consumed by ops dashboards, not by an end-user. Engineering quality call.
- **Finding 9 (F2 latency trigger 500ms)** — the threshold is an internal observability heuristic for triggering re-evaluation of an internal cache primitive choice, not a customer SLA or contract. Engineering quality call.
- **Findings 3 + 12 (architecture.md rule additions)** — these extend `architecture.md` § Architecture Rules with internal-engineering policy (lock-scope default, partial-execution rule). The rules govern internal service authoring, not user-facing surfaces. Already inside this spec's already-named architecture.md write surface (introduced for B2-ext + H1 in earlier rounds); no new cross-spec contract emerges.

No escalations triggered:
- No `defer` recommendations (all confident applies).
- No contract changes with `architecture.md` or `docs/spec-context.md` that propagate cross-spec — the architecture.md rule extensions are internal-engineering policy refinements inside the same paragraph wave already in flight.
- No `[missing-doc]` rejects — all findings align with existing posture (`prefer_existing_primitives_over_new_ones`, `static_gates_primary`, `runtime_tests: pure_function_only` carve-out).
- High confidence on every fix.

Top themes (Round 4): drift prevention over time (baseline-rot rule, calibration-constant grep patterns, follow-up coupling), measurable triggers (F2 re-evaluation thresholds, A1b shim-usage greps, sequencing C1-first), coverage shape (A2 write-path contract, B2 test-hook production safety, C1 subscript output), observability discipline (H1 log rate-limiting), and cross-cutting partial-execution rule (§0.5).

### Applied (auto-applied technical)

- [auto] Added §0.5 "No silent success on partial execution" cross-cutting meta rule (3 approved patterns: roll back fully / structured partial-state / log explicit partial execution).
- [auto] Added §0.6 "Architecture default lock scope" cross-cutting rule (per-org by default; deviation must be justified inline).
- [auto] Added §0.7 "Baseline rot prevention" cross-cutting rule (any baseline-count increase requires PR-description note; social enforcement, no automated check).
- [auto] A1b pre-condition added — mandatory shim-usage greps (`@deprecated — remove in A1b` count == N; bare-`organisationId` and bare-`orgId` callers == 0; cross-check from inventory) before A1b begins. DoD updated to require capturing the grep output in build-slug progress log.
- [auto] A2 Phase 3 — Proxy coverage completeness section added: written contract that service-layer writes to tenant tables go through builder methods OR call `assertRlsAwareWrite`; advisory grep gate added inside existing `verify-rls-protected-tables.sh` (no new file — preserves §0.2 A2 file budget; gate now carries 3 checks). §0.2 A2 line updated. A2 Phase-3 DoD updated; architecture.md rule line extended.
- [auto] B2 `__testHooks` production-safety invariant added (tree-shaken or no-op in prod; no execution change when unset; reset-on-import in test boundaries; canonical call-site pattern). Optional gate now also includes advisory check on unguarded `await __testHooks.` calls.
- [auto] B2-ext architecture.md rule line extended — adds explicit "default lock scope is per-org" + partial-execution-rule reference per §0.5.
- [auto] C1 subscript-output constraint added (no application-level output after parent's `emit_summary`; gate self-test extended with deliberately-misconfigured-subscript fixture exercising both grep-form and strict-tail-form parsers).
- [auto] C3 Phase-5A spec coupling added — Phase-5A spec MUST include C3 3-set upgrade as checklist item in its own §1; C3 implementer adds the line directly if a Phase-5A spec already exists at C3 ship time.
- [auto] D3 calibration-constant change discipline refined — grep pattern + short description per excluded occurrence (NOT absolute line numbers); reviewers verify exactly-one-hit per pattern at PR review time; updated comment shape in spec.
- [auto] E2 acceptance criteria updated to reference §0.7 — if E2 commits a baseline above zero, PR description includes the §0.7 baseline note.
- [auto] F2 case (b) deferral entry shape updated — explicit measurable re-evaluation triggers (second KV-with-TTL use case OR latency >500ms median rolling 24h OR configDocuments-domain build slug opens) + owner + back-link.
- [auto] H1 `logDataDependencyMissing` helper rate-limiting contract added — Pattern A (once per key per 60s, env-tunable) OR Pattern B (first occurrence WARN, subsequent DEBUG); choice documented in JSDoc + architecture.md rule line; tests cover both first-occurrence emit and rate-limited-skip / debug-downgrade behaviour.
- [auto] §2 sequencing — C1 moved from position 4 to position 2 (was 4 → now 2; every subsequent position re-numbered: G1=3, D1/D2/D3=4, E1/E2=5, B1/C4=6, C2/C3=7, A3/F1=8, F2=8b, H1=9, A1a=10, A1b=11, B2=12, A2=13). Critical-path summary updated. Wave 1 description updated to note C1 must precede every other gate item.
- [auto] Spec header "Last revised" date stamp updated to reflect Round 4.

### Integrity check

Integrity check: 1 issue found this round (auto: 1, escalated: 0).

1. The §0.5 / §0.6 / §0.7 sub-headings were initially appended in the wrong order (§0.5 inserted before §0.4 by accident). **Mechanical fix applied:** moved §0.5 and §0.6 to follow §0.4 numerically; §0.7 appended at end of §0; §0.4's referenced predecessors (§0.1 / §0.2 / §0.3) remain stable; §0.5's reference to "§0.4 (determinism over cleverness)" now resolves correctly because §0.4 precedes §0.5. Verified by reading lines 71–155 to confirm sequential numbering.

Cross-references touched in Round 4 (§0.5 referenced from B2/A2/H1/A1a contexts; §0.6 referenced from B2-ext architecture.md DoD line; §0.7 referenced from E2 acceptance criteria; §0.5 referenced inside the B2-ext architecture.md rule paragraph; A1b approach + DoD references the new pre-condition section; A2 §0.2 file-budget line updated to "single file with three checks"; A2 Phase-3 DoD references the new write-path advisory check; sequencing position numbers re-numbered — all 13 rows present and contiguous). All resolve correctly. No empty sections, no broken anchors. The TOC does not enumerate §0 sub-headings, so no TOC update is required.

Post-integrity sanity (4c): the one mechanical fix above (reorder §0.5/§0.6 after §0.4) was a simple structural reordering — no chained references, no cascading edits. Verified §0.5's "§0.4 analogue" sentence resolves correctly. No left-empty sections, no broken anchors. The §2 sequencing position re-numbering touched 11 row labels (positions 2-13); spot-checked that the critical-path summary's Wave 1 / Wave 2 / Wave 3 references match the new positions and that C1's "now shipped at position 2" annotations on D3, E2, C2 row "Why" columns are consistent. Confirmed the architecture.md DoD lines that mention "the H1 derived-data null-safety rule and the B2 concurrency-model rule" in §4 Exit criteria still match the rule additions across rounds.

Top themes (Round 4): drift prevention over time, measurable triggers, coverage-shape clarification, observability discipline, cross-cutting partial-execution rule.

---

## Round 5 — 2026-04-26T11-47-00Z (Closing verdict — no edits)

### ChatGPT Feedback (raw)

> You're done. At this point, anything more would move from signal → noise or precision → overfitting.
>
> No structural gaps. No meaningful edge cases unaddressed. No further tightening required.
>
> You've crossed the line from 'good spec' to execution-grade system design. Ship it.
>
> If a gate fails, we stop. We don't workaround the spec. We fix the system.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| 1 | Closing verdict — "Ship it" — no further tightening required | technical | reject (no-op) | auto (reject) | n/a | Closing verdict, not a finding requiring spec edits. Captured as the explicit signal to finalise. |
| 2 | Cultural directive: "If a gate fails, we stop. We don't workaround the spec. We fix the system." | technical | apply (route to KNOWLEDGE.md, not spec) | auto (apply) | n/a | Execution-discipline guidance, not spec-shape guidance. Per the user's finalisation note, captured as a KNOWLEDGE.md pattern entry rather than a spec edit. No spec change required. |

### Triage notes

Both items classified as `technical`. Round 5 produced zero spec edits — the verdict was a closing signal and the cultural note routes to KNOWLEDGE.md per user direction.

No escalations triggered. No integrity check needed (no edits applied).

### Applied (auto-applied technical)

None. Round 5 finalises the session.

---

## Final Summary

- Rounds: 5 (Round 5 was closing verdict, no edits)
- Auto-accepted (technical):
  - Round 1: 8 applied | 1 rejected | 0 deferred
  - Round 2: 11 applied | 0 rejected | 0 deferred
  - Round 3: 8 applied | 0 rejected | 0 deferred
  - Round 4: 12 applied | 0 rejected | 0 deferred
  - Round 5: 1 applied (KNOWLEDGE.md only, no spec edit) | 1 rejected (closing verdict, no-op) | 0 deferred
  - **Totals: 40 applied | 2 rejected | 0 deferred**
- User-decided: 0 applied | 0 rejected | 0 deferred (every finding was internal-quality / technical and auto-handled per the agent's triage rules)
- Index write failures: 0 (clean)
- Deferred to `tasks/todo.md` § Spec Review deferred items / `audit-remediation-followups`: **none** — every round was fully applied; explicitly no deferrals to route.
- KNOWLEDGE.md updated: yes (3 entries — see entry titles in the finalisation message)
- Implementation readiness checklist:
  - All inputs defined: yes (each item carries Source / Goal / Approach / Acceptance / Tests / Risk)
  - All outputs defined: yes (each item's Acceptance + Tests sections)
  - Failure modes covered: yes (Risk sections + §0.5 partial-execution rule + §4.1 per-item integrity check)
  - Ordering guarantees explicit: yes (§2 sequencing with 13 ordered positions and rationale)
  - No unresolved forward references: yes (verified by integrity checks across rounds)
- Consistency check: no contradictions across rounds. The C3 branch handling tightened progressively across rounds (Round 2 forced a decision; Round 3 added owner+trigger; Round 4 added Phase-5A spec coupling) — each refinement extends the prior round's contract rather than reverting it.
- Closing verdict: ChatGPT issued explicit "Ship it" approval in Round 5 with no remaining structural gaps or edge cases.
- PR: #201 — https://github.com/michaelhazza/automation-v1/pull/201
- Status: **Session closed — merge-ready**

---
