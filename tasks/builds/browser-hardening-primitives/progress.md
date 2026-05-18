# Progress — browser-hardening-primitives

**Build slug:** browser-hardening-primitives
**Class:** Significant
**Branch:** browser-hardening-primitives
**Spec status:** Phase 1 in progress (spec-coordinator inline, 2026-05-18)

---

## Phase 1 status

| Step | Status | Notes |
|---|---|---|
| Step 0 — Context load + PLANNING lock | complete | Operator overrode prior MERGE_READY lock (wave-6 PR #343 queued); lock flipped to PLANNING for this slug |
| Step 1 — TodoWrite skeleton | complete | 13 items |
| Step 2 — Branch-sync S0 | complete | 0 commits behind main; no merge needed |
| Step 3 — Intent intake + UI-touch detection | complete | `intent.md` authored; `ui_touch = true`; operator skipped mockups (thin surface) |
| Step 3a — Duplication / Strategy Check | complete | clear / clear / proceed |
| Step 3b — Grill-me Q&A | complete | 13 questions; operator accepted Q1+Q2 individually; Q3–Q13 locked en bloc with recommended answers |
| Step 4 — Slug ratification + directory | in progress | Slug = `browser-hardening-primitives` (matches branch); directory pre-existing |
| Step 5 — Mockup loop | SKIPPED | Operator decision — thin UI surface, slots into existing settings/workflow patterns |
| Step 6 — Spec authoring | complete | `spec.md` written (574 lines initial); skeleton + 12 chunks via chunked-write workflow |
| Step 7 — spec-reviewer | complete | Codex 4 of 5 iterations; READY_FOR_BUILD; 34 mechanical fixes; 0 directional; 1 ambiguous (BHP-1 → tasks/todo.md) |
| Step 8 — chatgpt-spec-review (MANUAL) | complete | 3 rounds; 9 findings auto-applied; spec LOCKED (Status: accepted). Log: tasks/review-logs/chatgpt-spec-review-browser-hardening-primitives-2026-05-18T01-00-00Z.md |
| Step 9 — Handoff write | complete | `handoff.md` written (chunked workflow, 3 sections); all 13 grill decisions + Q1 file-inventory-grounding decision + 10 architect-pick items + 7 deferred items |
| Step 10 — current-focus.md → BUILDING | complete | flipped PLANNING → BUILDING; `active_plan` slot reserved for Phase 2 plan.md |
| Step 11 — End-of-phase prompt | in progress | auto-commit + push, then operator-facing close-out |

---

## Decisions log (Phase 1)

- **Lock override (2026-05-18):** wave-6 MERGE_READY lock overridden by operator; current-focus.md flipped to PLANNING for this slug. Prior PR #343 still queued at ready-to-merge.
- **Mockups skipped:** operator chose to skip mockup loop. Architect pins UI surface in spec citing existing tenant-settings / workflow-config patterns.
- **Class:** Significant per brief (three Standard sub-features bundled under one spec).
- **Build size:** all three primitives ship in one build / one spec / one PR, phased internally by chunks. Operator instruction: "do it all in this one development pass, just in different steps or phases if required."
- **Grill termination:** operator approved 11 of 13 grill answers en bloc; Q1 (file-inventory grounding fix) and Q2 (phasing order) approved individually.

---

## Open items routed forward to Phase 2

None for the architect to discover — every operator-level decision is locked in `intent.md § Grill-me Q&A`. Architect-pick items (exact latency budget numbers within the four-bucket policy, GeoIP refresh job schedule, benchmark workflow choice for latency threshold, exact per-PR detection-site subset of 5–10) are flagged inside the spec as `architect picks` with the bounding constraints already locked.

---

## Phase 2 status

| Step | Status | Notes |
|---|---|---|
| Step 0 — Context load + BUILDING lock | complete | 2026-05-18 (Opus session) |
| Step 1 — TodoWrite skeleton (29 items after chunk expansion) | complete | |
| Step 2 — Branch-sync S1 + freshness check | complete | 0 commits behind main; no merge needed; no migration collisions |
| Step 3 — architect invocation | complete | 11 chunks across 3 phases (4 / 4 / 3); 8 of 10 architect-pick items resolved inline, 2 punted with rationale |
| Step 4 — chatgpt-plan-review R1 (manual) | complete | 3 findings closed: F1 framing departure (operator-ratified), F2 gate timing (auto-fixed), F3 allowlist (auto-fixed). Log: `tasks/review-logs/chatgpt-plan-review-browser-hardening-primitives-2026-05-18T01-16-26Z.md` |
| Step 4 — chatgpt-plan-review R2 (manual) | complete | 2 findings closed: F4 credentials via `credentialBrokerService` (auto-fixed), F5 no bundled GeoLite2 (auto-fixed). Operator instructed "lock after this". |
| Step 5 — plan-gate | complete | Operator chose "Proceed" before R1; "lock after this" after R2. Plan LOCKED. |
| Plan-lock commit | complete | `17820345 docs(browser-hardening-primitives): plan LOCKED + chatgpt-plan-review R1+R2 (5 findings closed)` — pushed to origin |
| Step 6 — Per-chunk loop | **PAUSED for model switch** | Per CLAUDE.md § *Model guidance per phase*: plan-gate is the Opus → Sonnet checkpoint. Operator chose to stop here. |
| Step 7 — G2 | pending | |
| Step 8 — Branch-level review pass | pending | |
| Step 9 — Doc-sync gate | pending | |
| Step 10 — Phase 2 handoff write | pending | |
| Step 11 — current-focus.md → REVIEWING | pending | |

---

## Resume instruction (Sonnet session)

The next Claude Code session (Sonnet) resumes the feature-coordinator chunk loop. Type:

```
resume feature coordinator chunk loop for browser-hardening-primitives
```

The new session adopts the feature-coordinator playbook inline, reads `tasks/builds/browser-hardening-primitives/plan.md` + `handoff.md` + this `progress.md`, detects the resume state (plan-gate complete; no chunks built yet), and dispatches `builder` for **Chunk 1 (`harness-history-table-and-writer`)**.

### Resume-time pre-flight (the Sonnet session runs these BEFORE Chunk 1)

Per feature-coordinator playbook §Step 6 "Resume detection":

1. Run `npm run typecheck` ONCE to confirm the branch is type-clean before any chunk runs. (Spec + plan + handoff edits should not affect typecheck, but the playbook requires this check before resuming.) Cap: 3 fix attempts; escalate if it fails.
2. No prior chunks recorded as `done` → no per-chunk skip detection needed.
3. No prior `## Environment snapshot` section in this progress.md → no comparison needed (snapshot will be written at Chunk 1 close).

### Chunk loop discipline reminders

- Process chunks **strictly in plan order** (1 → 11). Do not start chunk N+1 until chunk N is committed and pushed.
- Per chunk: dispatch `builder` sub-agent with plan path + chunk name + declared files list; after builder returns SUCCESS, run G1 (`npm run lint && npm run typecheck`); enforce commit-integrity invariant (working tree files subset of declared files); `git add <declared files only>` (never `-A` or `.`); commit + push; update this `progress.md` (chunk done + refresh `## Environment snapshot`).
- Cap G1 at 3 fix attempts per chunk; cap plan-gap at 2 rounds per chunk; cap fix-loop at 3 rounds per blocking finding.
- Per chunk commit message format (from playbook): `chore(feature-coordinator): chunk {N} complete — {chunk-name} (G1 attempts: {N})` + the Claude co-author trailer.

### Critical contracts the Sonnet session must NOT drift on

(From `handoff.md § Critical contracts` and the chatgpt-plan-review R1+R2 lock-ins.)

- **NO forbidden vocabulary anywhere** (identifiers, files, telemetry, copy): `stealth | evade | bypassDetection | antiFingerprint | undetectedBrowser | cloak | ghost`. Pre-commit grep is a builder responsibility.
- **`HarnessRunResult` outcome enum closed:** `'pass' | 'fail' | 'baseline_established' | 'site_unavailable' | 'parse_error'`. Blocking CI failure set: `{ 'fail', 'parse_error' }`. Do not extend without a spec amendment.
- **`proxyConfig` JSONB shape:** `{ url: string, credentialId?: string }` — NEVER raw username/password. Migration CHECK forbids those keys.
- **Credential injection:** via `credentialBrokerService.injectIntoEnvironment` at sandbox-launch time using a `proxyUrlEnvKey` envelope field that names the env var. Credentials NEVER in `taskPayload`, NEVER in telemetry, NEVER in `/workspace/input.json`.
- **No bundled GeoLite2 binary** ever committed (`infra/geoip/.gitignore` blocks). Deploy-time `scripts/bootstrap-geoip-db.sh` is the only acquisition path; `GEOIP_LICENCE_KEY` unset = graceful no-GeoIP degradation.
- **Baseline-weakening gate** scans `git log origin/main..HEAD --format=%B` (branch commits PRE-merge); CI `actions/checkout` MUST use `fetch-depth: 0`. V1 allowlist: `{ '@michaelhazza', 'michaelhazza' }`.

### Spec deviations locked at plan-gate (do not surface as gaps)

- **BHP-2 (framing departure):** nightly harness runs cached fixtures only in V1 — documented in `handoff.md § Spec deviations` and `tasks/todo.md`. Phase 3 `chatgpt-pr-review` re-validates at finalisation. Do not re-open at chunk authoring.
- **subaccountSettings → subaccount_iee_browser_settings:** spec named a non-existent table; plan extends the existing IEE-browser settings table instead. Locked at plan-gate.
