# Spec Review Log — pre-launch-phase-3 — Iteration 1

**Spec:** `tasks/builds/pre-launch-phase-3/spec.md`
**Iteration:** 1 of 5
**Codex output:** `tasks/review-logs/_codex_pre-launch-phase-3_iter1_20260505T121836Z.txt`

---

## Codex findings

14 findings, severities: 1 critical, 7 important, 5 minor, 1 nit.

## Rubric pass

No new findings beyond what Codex caught. Spec is structurally clean — frontmatter present, framing-aligned section present, deferred-items section present. The 14 Codex findings are the substantive set.

## Classifications and dispositions

### FINDING #1 — L5 cost-gate test placeholder must be specified, not just unskipped
- Source: Codex
- Section: §4.L5 lines 242-248, §3 lines 103-104
- Classification: mechanical
- Reasoning: The placeholder `describe.skip(...)` block at `verificationMatrix.test.ts:836-840` has only an `it` title with no body. Spec said "Remove `.skip`" but there's nothing to unskip. Implementation-specifying, not scope-changing.
- [ACCEPT] §4.L5
  - Fix applied: rewrote §4.L5 Fix block from 3 bullets into 7 bullets specifying fixture seeding (inline helper, no separate asset), cost measurement (logger spy on `optimiser.render.tokens_used`), assertion (`< $0.02/sa/day` over 5sa × 7d), workflow body, annotation (`::notice::`), secret-absence behaviour (early-exit with warning).

### FINDING #2 — L4 must match actual `decideOutcomeMeasurement` signature
- Source: Codex
- Section: §4.L4 lines 225-232
- Classification: mechanical
- Reasoning: `decideOutcomeMeasurement` has no `preSnapshot` input; can return `measure` without `postAssessment`. Spec described a contract that doesn't match the actual function.
- [ACCEPT] §4.L4
  - Fix applied: rewrote test-cases bullet list from "pre-snapshot present/absent" to four cases that actually map onto the function shape (window-not-elapsed gate, account-or-snapshot precondition, operator-alert exception, full-input happy path) and cited the actual signature line range.

### FINDING #3 — File inventory test paths
- Source: Codex
- Section: §3 lines 110-112, §10 lines 403-406
- Classification: mechanical
- Reasoning: `server/lib/__tests__/rateLimitKeys.test.ts` and `server/lib/__tests__/env.test.ts` do not exist. Actual files: `server/services/__tests__/rateLimitKeysPure.test.ts` and `server/lib/__tests__/encryptionKeyValidator.test.ts`.
- [ACCEPT] §3 / §10 / §4.L3 §Test
  - Fix applied: pointed L3 test at the real `rateLimitKeysPure.test.ts`. Replaced the env.test.ts reference with a NEW file `webhookSecretValidatorPure.test.ts` that mirrors the existing `encryptionKeyValidator.test.ts` shape. Updated §10 testing posture, §4.L3 Test bullet, and §3 Tests table.

### FINDING #4 — L2 test cannot mirror non-existent middleware test pattern
- Source: Codex
- Section: §3 line 112, §4.L2 line 181
- Classification: mechanical
- Reasoning: `server/middleware/__tests__/` does not exist; no `requireOrgPermission` test pattern to mirror. Spec referenced a non-existent harness.
- [ACCEPT] §4.L2 + §3
  - Fix applied: refactored L2 to extract a pure helper `decidePermissionDenialEvent` and test it directly via `server/lib/__tests__/requireSubaccountPermissionPure.test.ts` — keeps decision logic in pure code (testable without a request mock) and uses the codebase's `*Pure.ts` + `*.test.ts` convention. Middleware boundary stays a one-liner that wires the helper.

### FINDING #5 — L5 "merges are blocked" load-bearing claim without mechanism
- Source: Codex
- Section: §4.L5 lines 247-248, §12 line 436
- Classification: mechanical
- Reasoning: Failing a workflow does not automatically block merges — that requires a branch-protection rule. Load-bearing claim without enforcement.
- [ACCEPT] §4.L5 / §12 / §13
  - Fix applied: clarified in §4.L5 that the workflow fails the run; explicitly named branch-protection as operator action. Softened §12 done-definition language ("merges are blocked at ≥ $0.02/sa/day" → "the workflow fails the run when measured cost ≥ $0.02/sa/day; branch-protection is operator action — see §13"). Added a new §13 deferred item for branch-protection configuration.

### FINDING #6 — L3 self-contradiction (rationale vs contract)
- Source: Codex
- Section: §4.L3 lines 207-209 vs §8 lines 354-355
- Classification: mechanical
- Reasoning: Internal contradiction. §4.L3 said "both must trip together" but §8 contract says "either trip → 429."
- [ACCEPT] §4.L3
  - Fix applied: rewrote rationale paragraph to match the actual implementation (independent buckets, either trip → 429), and re-justified the limit choices against that semantics so legitimate traffic is not impacted.

### FINDING #7 — L1 testing posture should be static-gate, not manual
- Source: Codex
- Section: §10 line 403, §12 line 432
- Classification: mechanical
- Reasoning: L1 is launch-boundary security. The codebase's `static_gates_primary` + `pure_function_only` envelope already covers this exact pattern (`encryptionKeyValidator.test.ts`). Spec was right that the pattern existed but wrong about the path AND wrong to mark the test optional.
- [ACCEPT] §3 / §10 / §12
  - Fix applied: named a new `validateWebhookSecretOrThrow()` validator function in `server/lib/env.ts`, listed `webhookSecretValidatorPure.test.ts` `[NEW]` in §3 Tests, and updated §10 to require the test (not optional).

### FINDING #8 — `tasks/current-focus.md` missing from §3 inventory
- Source: Codex
- Section: §3 lines 116-122, §11/§12
- Classification: mechanical
- Reasoning: Pure file-inventory drift. §11 and §12 reference the file but §3 doesn't list it.
- [ACCEPT] §3 Docs table
  - Fix applied: added a row for `tasks/current-focus.md` with the expected post-merge update.

### FINDING #9 — §13 deferred items omits CHATGPT-R1-6, CHATGPT-R1-8
- Source: Codex
- Section: §13
- Classification: mechanical
- Reasoning: §13 already includes other entries from the same `chatgpt-pr-review` cluster (R1-4, R1-7); asymmetric omission is a hygiene call.
- [ACCEPT] §13
  - Fix applied: added an "Inclusion rule" paragraph at the top of §13 stating that the spec scopes to security/correctness items and explicitly noting that R1-6 (architecture call) and R1-8 (UX design call) stay in `tasks/todo.md` under their own markers — making the exclusion rule explicit rather than implicit.

### FINDING #10 — H4 runbook scope mismatch
- Source: Codex
- Section: §4.H4 lines 290-296, runbook
- Classification: mechanical
- Reasoning: Spec listed 2-3 runbook entries; runbook actually has 6.
- [ACCEPT] §4.H4 + §3 Docs row
  - Fix applied: §4.H4 now lists all six runbook entries (AC-CGPT-R3-3, AR-CGPT-R3-1, CHATGPT-R1-7, F3, DG-4, CHATGPT-R1-4). §3 Docs row updated to match.

### FINDING #11 — Why-section count from "four" to "five"
- Source: Codex
- Section: line 15
- Classification: mechanical
- Reasoning: Pure count error. List has 5 markers, prose said "four."
- [ACCEPT] line 15
  - Fix applied: "four" → "five"; "three already closed" → "four already closed."

### FINDING #12 — AC-ADV-10 / D15 verification rows have stale "Hygiene only" label
- Source: Codex
- Section: §2 lines 75 and 79
- Classification: mechanical
- Reasoning: Both items are "verified closed" with closure already on main; no `[OPEN]` marker exists to flip. "Hygiene only" promised an action that §4 doesn't deliver.
- [ACCEPT] §2 verification log
  - Fix applied: replaced "Hygiene only" with "No action — closure is already encoded in code; no `[OPEN]` marker exists / no marker to flip" on both rows.

### FINDING #13 — §1 framing line cites wrong CI workflow primitive
- Source: Codex
- Section: line 62
- Classification: mechanical
- Reasoning: L5 introduces a NEW workflow `optimiser-cost-gate.yml`; spec said it extends `verify-workspace-actor-coverage.yml`.
- [ACCEPT] line 62
  - Fix applied: removed the wrong primitive citation and added an explicit "one exception" sentence noting L5 is a new static gate, consistent with `static_gates_primary` posture.

### FINDING #14 — §9 stale "Unique-constraint-to-HTTP mapping" label for L4
- Source: Codex
- Section: §9 lines 389-391, §14 line 480
- Classification: mechanical
- Reasoning: L4's `23505` is job-level no-op, not an HTTP boundary. Wording mislabel.
- [ACCEPT] §9 + §14
  - Fix applied: §9 subsection renamed to "Unique-constraint handling (job-level — no HTTP boundary)" with explicit prose explaining no HTTP boundary exists. §14 checklist line updated to match.

---

## Iteration 1 Summary

- Mechanical findings accepted:  14
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0 (no items routed to tasks/todo.md)
- Spec commit after iteration:   dd08e9a9
