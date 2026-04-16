# Spec Review Final Report

**Spec:** `docs/routines-response-dev-spec.md`
**Spec commit at start:** `16925715879d765a127bdafda43c738031e2bafd`
**Spec commit at finish:** working tree modified (uncommitted in-progress edits above base commit)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 5 of 5 (MAX_ITERATIONS)
**Exit condition:** two-consecutive-mechanical-only (iterations 4 and 5 both had zero directional/ambiguous/reclassified findings); iteration-cap also reached simultaneously

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|---|---|---|---|---|---|---|
| 1 | 10 | 2 | 6 | 1 | 5 | 0 | resolved |
| 2 | 8 | 0 | 5 | 0 | 3 | 0 | resolved |
| 3 | 12 | 1 | 11 | 0 | 1 | 1 | resolved |
| 4 | 12 | 0 | 12 | 0 | 0 | 0 | none |
| 5 | 9+2* | 0 | 11 | 0 | 0 | 0 | none |

*Iteration 5 initially applied 9 findings. Two additional Codex findings (#5 and #6 from `/tmp/codex-iter5-output.txt`) were missed in the initial pass and applied as a post-hoc patch (D10, D11): route mount point `server/routes/index.ts` missing from §4.5 inventory, and `server/routes/llmUsage.ts` / `server/services/reportingService.ts` missing as enforcement-scope files for the §4.7 `is_test_run` filter invariant. Exit condition and stopping heuristic are unchanged — both were still mechanical-only rounds.

## Mechanical changes applied

All changes applied via Edit to `docs/routines-response-dev-spec.md`.

### §1 — Summary / north star
- "config assistant" replaced with "Playbook Studio chat" (iter 3, C1)

### §2 — Context and rationale
- "All three features" → "The three user-facing build features (1, 2, 3)" (iter 4, C2)
- Design constraint narrowed to "every new production run-creation path"; test-run paths noted as exempt with reference to §4.6 (iter 5, D3)

### §3 — Feature 1 — Scheduled Runs Calendar
- §3.2: heartbeat and cron override precedence stated — link-level values take precedence over agent-level defaults (iter 4, C5)
- §3.3: `estimatedTokens`/`estimatedCost` changed to `number | null` (iter 3, C3); null-aggregation rule added to totals field comment (iter 3, R1)
- §3.3 file inventory: "Existing files modified by Feature 1" table added — `routes/index.ts`, `App.tsx`, `permissions.ts`, `permissionSeedService.ts` (iter 4, C8); sidebar nav and subaccount tab nav components added (iter 5, D4)
- §3.4 permission block: rewritten as per-surface table — `org.agents.view` (org page), `subaccount.workspace.view` (subaccount main page), `subaccount.schedule.view_calendar` (portal card path for `client_user`) (iter 5, D9)
- §3.6 step 6: note added that `is_test_run` filter requires Feature 2 migration; safe to write in Commit 2, effective in Commit 3 (iter 5, D1)
- §3.7: out-of-range window test corrected to assert 400; valid-window-no-occurrences bullet added (iter 3, C2); permission test updated to match per-surface permission model (iter 5, D9)

### §4 — Feature 2 — Inline Run Now test UX
- §4.2: `SystemAgentEditPage.tsx` removed from scope; org/subaccount authoring pages only (iter 3 HITL, Finding 3.1)
- §4.2 file table: updated from "(3 files)" to "(2 files)" naming both pages explicitly (iter 3 HITL consequential)
- §4.3 input block: fixture picker behavior stated — subaccount users see own subaccount fixtures only; org admins see all within org (iter 5, D2)
- §4.3 token/cost meter: budget source named — `agents.tokenBudget` / org-level default from `server/config/limits.ts` (iter 5, D6)
- §4.4 access matrix added: org admins read/write all within `organisation_id`; subaccount users see only own fixtures; `client_user` excluded; enforced via `assertScope()` in `agentTestFixturesService` (iter 3 HITL, Finding 3.2)
- §4.5 "Files introduced": `server/services/agentTestFixturesService.ts` row added (iter 5, D5)
- §4.5 "Existing files modified": `server/config/limits.ts` row added (iter 4, C9); agent edit pages named explicitly (iter 3 HITL consequential); `server/routes/index.ts` (mount point) added (iter 5, D10); `server/routes/llmUsage.ts` and `server/services/reportingService.ts` added for §4.7 `is_test_run` enforcement (iter 5, D11)
- §4.6: idempotency key changed from epochSeconds to epochMilliseconds (iter 3, C5); key noted as intentionally unique-per-call and exempt from §2 convention (iter 4, C3); skill test-run routes made explicit with full paths (iter 4, C10)
- §4.7: rate-limit enforcement point named — `TEST_RUN_RATE_LIMIT_PER_HOUR` in `limits.ts`; in-memory sliding-window counter in route handler (iter 4, C7); cost backfill updated to use `WHERE is_test_run = false` (iter 3, C6)

### §5 — Feature 3 — n8n Workflow Import
- §5.3: file inventory table added (iter 3, C11); `sideEffectClass: 'none'` clarified as external-side-effects only (iter 4, C4); step types anchored to `playbook_validate` schema (iter 3, C10)
- §5.4: `lmAnthropicClaude` short key corrected from `anthropicClaude` (iter 3, C8)
- §5.6: `sideEffectClass` field named on playbook step object; `n8nImportServicePure.ts` named as writer (iter 5, D8)
- §5.7: integration test clarified to use `skill_simulate` path (iter 3, C9)

### §6 — Feature 4 — Positioning refresh
- §6.1: "three shipped features" → "three planned build features … anticipating Features 1–3" (iter 5, D7)
- §6.2: "per-agent" → "per-agent/per-skill" test-fixture description (iter 4, C12); temporal language replaced with §8 commit labels (iter 3, C12)

### §7 — Feature 5 — Strategic stance
- §7.2: temporal language replaced with §8 commit labels (iter 3, C12)
- §7.4: pointer update clarified as part of Commit 1 (iter 4, C1)

### §8 / Closing note
- §8: file inventory headers added for Features 1 and 2 (iter 3, C11)
- Closing note: reconciled with §7.4 — pointer update is part of Commit 1 (iter 4, C1)

### §11 — Open items
- "Compare with previous version" and "Make.com/Zapier importers" items now carry explicit "Deferred —" verdict prefix (iter 4, C11)

## Rejected findings

| Iter | Section | Description | Reason |
|---|---|---|---|
| 1 | §3.3 | Codex suggested changing the projection function signature to emit rrule/scheduleTime fields | Spec already defines the function signature correctly; Codex misread the table column headings. Rejected as hallucination. |

(All other findings over 5 iterations were either accepted or sent to HITL.)

## Directional and ambiguous findings (resolved via HITL)

**Iteration 1 HITL (5 directional findings):**
- §3.1 heartbeat projection scope: `apply` — confirmed projected occurrences are read-only and stateless
- §3.3 org-wide roll-up parameter shape: `apply` — `subaccountId` added as optional filter param
- §4.1 "Run Now" label vs "Test" semantics: `apply` — panel is exclusively a test surface; production manual runs stay on agent detail page
- §4.3 always-on "This is a test run" indicator: `apply` — indicator is always-on, not toggleable
- §5.1 n8n import framing as migration wedge: `reject` — framing is intentional product stance, not a spec inconsistency

**Iteration 2 HITL (3 directional findings):**
- §4.2 skill_simulate note for skill test runs: `apply` — note added that skill test runs create `agent_runs` rows via `skill_simulate`
- §4.3 toggle vs always-on indicator (second appearance): `apply` — always-on confirmed
- §3.5 portal card as optional stretch: `apply-with-modification` — "(stretch)" removed, portal card is core to the feature

**Iteration 3 HITL (1 directional + 1 ambiguous):**
- §4.2/§4.7 `SystemAgentEditPage.tsx` in scope but system-agent test runs disallowed: `apply` — `SystemAgentEditPage.tsx` removed from Feature 2 scope
- §4.4 RLS policy under-specified for polymorphic table: `apply-with-modification` — explicit access matrix added per human's specification

## Open questions deferred by stop-loop

None. The loop ran to the iteration cap (5 iterations) with all findings resolved before stopping. No `stop-loop` decisions were made.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 5 iterations. The human has adjudicated every directional finding that surfaced (10 total across iterations 1–3; 0 in iterations 4 and 5).

However:

- The review did not re-verify the framing assumptions in `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's framing sections (§1–§2) yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not surface. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.

**Recommended next step:** read the spec's framing sections (§1 and §2, first ~65 lines) one more time, confirm the north-star acceptance test and headline findings match your current intent, then start implementation — beginning with Commit 1 (Features 4 and 5, docs-only) per §8 build order.
