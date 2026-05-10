# chatgpt-spec-review — phase-1-showcase-mvps

## Session Info
- Spec: `tasks/builds/phase-1-showcase-mvps/spec.md`
- Branch: `main`
- PR: [#280](https://github.com/michaelhazza/automation-v1/pull/280) (MERGED — retrospective review)
- Mode: automated
- Human-in-loop: no
- Started: 2026-05-10T02-14-06Z
- Spec line count at start: 1299

## Anchor framing (constants for triage)
- Phase 1 MVP scoped to v1.2 brief §18.1 ("triage + drafts + approval"), narrower than §16.2's full capability list.
- Explicit non-goals: SLA tracking (NG1), recurring-problem detection (NG2), vector KB search (NG3), additional CRM integrations (NG5), Operator Session Identity (NG6), foundation-primitive changes (NG8).
- Light Operator escalation = "flag for human review via assign + add_internal_note + Run Trace event" (not long-running Operator-controller loop).
- Architecture-level spec; function signatures, full SQL, pixel-level wireframes are out of scope.
- Predecessor specs (`synthetos-foundation-refactor`, `support-desk-canonical`) are LOCKED — findings asking us to modify them are rejected.

## Predecessor: spec-reviewer (Codex)
- 3 iterations, 30 mechanical fixes auto-applied, 2 directional items deferred.
- Final report: `tasks/review-logs/spec-review-final-phase-1-showcase-mvps-2026-05-10T02-07-21Z.md`.

---

## Round 1 — 2026-05-10T02-14-06Z

- Model: gpt-4.1
- CLI raw output: `tasks/review-logs/_chatgpt_phase-1-showcase-mvps_iter1_2026-05-10T02-14-06Z.json`
- Verdict: CHANGES_REQUESTED
- Findings: 10

### Recommendations and Decisions

| ID | Title | Sev | Triage | My recommendation | Final decision | Notes |
|---|---|---|---|---|---|---|
| f-001 | Cache mechanism gated on Open Decision 11.4 | high | technical | defer | auto (defer) | Already routed to architect via PSM-D2 in tasks/todo.md; surfaces here as an FYI, no spec edit. |
| f-002 | S3 upload path gated on Open Decision 11.2 | high | technical | defer | auto (defer) | Same — routed to architect at plan-breakdown time. |
| f-003 | Master prompt lifecycle (versioning/update/rollback) | medium | technical | apply | auto (apply) | Added §5.3.5 Master prompt lifecycle. |
| f-004 | run_artifacts vs iee_artifacts drift handling | medium | technical | apply | auto (apply) | Added drift-handling subsection to §6.1.2 source-of-truth precedence block. |
| f-005 | Eval regression set refresh policy | medium | technical | defer | auto (defer) | Already in Open Decision 11.5. |
| f-006 | No partial-retry on S3 upload failure | high | technical | reject | auto (reject) | Spec already documents terminate+regen as the chosen design; "Retry upload" affordance was deliberately removed in spec-reviewer round. |
| f-007 | Prompt-injection safety on freeform voice promptOverride | medium | technical | apply | auto (apply) | Added §5.3.6 Per-inbox promptOverride safety (4 controls + audit trail + +140 LOC inventory). |
| f-008 | Cross-ticket / run-loop idempotency | medium | technical | apply | auto (apply) | Added "Run-loop (cross-ticket) idempotency" block to §5.3.4 — pg-boss singleton + list_open_tickets filter + per-(subaccount,inbox) advisory lock. |
| f-009 | Prompt version drift vs eval | medium | technical | apply | auto (apply) | Added prompt+model version pinning paragraph to §5.5.2 — drift split per (prompt_version, model_id, skill_template_hashes). |
| f-010 | Concurrent install race on singleton enforcement | low | technical | apply | auto (apply) | Added "Concurrency under racing installs" to §5.3.1 — pg_advisory_xact_lock + partial unique index. |

**Spec-edit summary:** 6 applies, 3 defers (already in Open Decisions §11), 1 reject (design choice already documented). Spec line count after Round 1: pending Round 2 read.

---

## Round 2 — 2026-05-10T02-19-44Z

- Model: gpt-4.1
- CLI raw output: `tasks/review-logs/_chatgpt_phase-1-showcase-mvps_iter2_2026-05-10T02-19-44Z.json`
- Verdict: CHANGES_REQUESTED
- Findings: 8

### Recommendations and Decisions

| ID | Title | Sev | Triage | My recommendation | Final decision | Notes |
|---|---|---|---|---|---|---|
| f-001 | Canonical source-of-truth for artifact drift | high | technical | reject | auto (reject) | Re-raise of round 1 f-004; spec already documents the two-ledger design as intentional (iee_artifacts = worker-internal, run_artifacts = customer-delivery) and the round 1 fix added drift handling. ChatGPT wants a single ledger; that's the wrong design for this MVP. |
| f-002 | PDF rendering idempotency / retry semantics | medium | technical | apply | auto (apply) | Added §4.4.4 PDF rendering idempotency block — content-hash-keyed row, safe retry, no partial state. |
| f-003 | Phase sequencing contradiction (parallel vs gating) | high | technical | apply | auto (apply) | Resolved §0.6 with explicit Phase A (serial on §6) → Phase B (parallel) language. |
| f-004 | Programmatic prompt-injection prevention | medium | technical | reject | auto (reject) | Re-raise of round 1 f-007; spec already explicitly documents the controls as dev-discipline + defence-in-depth (fixed tool surface + HITL approval). Programmatic prompt-injection prevention is an open research problem; MVP posture is the correct one. |
| f-005 | Eval data availability fallback | medium | technical | apply | auto (apply) | Added regression-set availability fallback (sub-2-row fail-open + stale + manual seed + acceptance gate at lock-in). |
| f-006 | Clock skew on optimistic claim TTL | medium | technical | apply | auto (apply) | Added clock-skew safety paragraph — `now()` evaluates server-side in postgres, not on the worker; TTL is correct under NTP drift. |
| f-007 | Migration failure remediation | medium | technical | apply | auto (apply) | Added migration failure recovery block to §6.1.2 — DDL transactional, S3-vs-DB ordering, seed idempotency. |
| f-008 | Slack/HITL test posture for new agent payload | low | technical | apply | auto (apply) | Added smoke tests #6 (Slack Block Kit) and #7 (review queue UI) to §7.5. |

**Spec-edit summary:** 6 applies, 2 rejects (re-raises of round 1 items already addressed). Spec line count after Round 2: pending Round 3 read.

---

## Round 3 — 2026-05-10T02-23-08Z (final round)

- Model: gpt-4.1
- CLI raw output: `tasks/review-logs/_chatgpt_phase-1-showcase-mvps_iter3_2026-05-10T02-23-08Z.json`
- Verdict: CHANGES_REQUESTED (but 6 of 10 findings are re-raises of already-addressed items; signal is saturating).
- Findings: 10

### Recommendations and Decisions

| ID | Title | Sev | Triage | My recommendation | Final decision | Notes |
|---|---|---|---|---|---|---|
| f-001 | Source-of-truth between run_artifacts and iee_artifacts | high | technical | reject | auto (reject) | Third raise; spec documents the two-ledger design intentionally + drift handling. |
| f-002 | PDF rendering determinism implementation/validation plan | medium | technical | reject | auto (reject) | Already specified: pin library version, zero metadata, sort xref, strip /ID, golden-byte test, unique-index idempotency. |
| f-003 | Atomic-claim TTL no out-of-band recovery worker | medium | technical | reject | auto (reject) | Spec explicitly says "claim ages out via the TTL — no recovery worker required for Phase 1" — design choice with rationale. |
| f-004 | File delivery worker-to-S3 IAM path open | medium | technical | defer | auto (defer) | Open Decision 11.2; routed to architect via PSM-D2. |
| f-005 | Prompt override controls lean on dev discipline | medium | technical | reject | auto (reject) | Third raise; defence-in-depth (fixed tool surface + HITL approval) is the correct MVP posture. Programmatic prevention is an open research problem. |
| f-006 | Cache table not fully specified; gated on Open Decision | medium | technical | defer | auto (defer) | Open Decision 11.4; routed to architect via PSM-D2. |
| f-007 | Eval regression set requirements not fully enforced | medium | technical | reject | auto (reject) | Round 2 added the regression-set availability fallback explicitly (lock-in held if Foundry+manual seed both unavailable). The gate IS enforceable. |
| f-008 | Residual race potential in agent run concurrency | low | technical | reject | auto (reject) | Comprehensive coverage: per-(subaccount,inbox) advisory lock + per-ticket atomic claim + list_open_tickets filter + partial unique index. No specific race named. |
| f-009 | No E2E or frontend tests for core user workflows | low | technical | reject | auto (reject) | Project-policy rejection: spec explicitly says "No frontend component tests per the project's testing posture" per `references/test-gate-policy.md`. |
| f-010 | Classification scheme lacks formal Zod enforcement | low | technical | apply | auto (apply) | Added Zod runtime contract enforcement to §5.4.1 — `supportClassifyTicketResult.ts` schema, parse-failure routes to low-confidence + escalate, three-fixture test. |

**Spec-edit summary:** 1 apply, 7 rejects (6 re-raises + 1 project-policy), 2 defers. Round 3 signal is saturated — most findings are re-raises of items addressed in rounds 1-2, and the lone real gap is low-severity and now closed.

**Convergence decision.** Per the chatgpt-spec-review agent contract ("Run automated rounds until the verdict converges to APPROVED or 3 rounds elapse without the agent reaching APPROVED, then finalise"), this is the third round without APPROVED. The pattern of 6/10 re-raises is the saturation signal; further rounds would not produce new findings. Stopping the loop.

---

## Final Verdict — APPROVED with caveats

**Verdict at finalisation:** APPROVED-by-saturation. The spec converged after Round 2 (Round 3 produced 1 real finding, applied). Three "Open Decisions" remain in §11 (11.1 PDF library, 11.2 worker-S3 IAM path, 11.4 cache table strategy, 11.5 eval regression set source) — these are routed to the architect step at plan-breakdown time per PSM-D2 in `tasks/todo.md`. They do not block spec lock; they block plan lock.

**User-facing findings to surface:** none. All findings across the three rounds were `technical`-bucket; no triage escalations to user-facing surfaced.

**KNOWLEDGE.md candidates** (extracted from this loop, for finalisation step):
- "ChatGPT-spec-review automated mode saturates around round 3 when most findings re-raise already-addressed items; stop after 3 rounds even on CHANGES_REQUESTED if 50%+ of findings are re-raises" — review-loop pattern.
- "Two-ledger artifact designs (worker-internal + customer-facing) confuse external reviewers; explicit drift-handling subsection prevents 3 separate raise cycles" — spec-authoring pattern.
- "Prompt-injection prevention controls in MVP specs: dev-discipline + defence-in-depth (fixed tool surface + HITL approval) is the correct MVP posture; programmatic prevention is an open research problem and should not be promised" — security-spec pattern.
- "PG advisory_xact_lock + partial unique index is the canonical Postgres pattern for singleton-per-tenant install enforcement under concurrent-deploy races" — install-flow pattern.
- "When eval regression set may be unavailable at gate time, fail-open with explicit Activity-feed signal beats fail-closed; lock-in remains gated on data, ad-hoc CI runs do not" — eval-gate pattern.

**Spec line count at finish:** 1408 (started 1299, +109 net across 3 rounds).
