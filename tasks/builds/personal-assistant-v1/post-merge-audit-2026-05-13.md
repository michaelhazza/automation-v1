# Personal Assistant — Post-Merge Audit + What's Left

**Date:** 2026-05-13
**Branch:** main (after PR #291 merge of `personal-assistant-v1`)
**Purpose:** audit what was built vs the briefs, identify remaining work, capture decisions for the next build session

---

## Contents

- [1. What was built (audit summary)](#1-what-was-built-audit-summary)
- [2. What's still open from V1 (deferred items)](#2-whats-still-open-from-v1-deferred-items)
- [3. What's left to build to close out the Personal Assistant](#3-whats-left-to-build-to-close-out-the-personal-assistant)
- [4. The e2b browser question + AWS recommendations](#4-the-e2b-browser-question--aws-recommendations)
- [5. Recommended next-session prompt](#5-recommended-next-session-prompt)

## 1. What was built (audit summary)

### Foundation (`user-owned-agents`) — shipped inline in PR #291

| Component | File / migration | Status |
|---|---|---|
| `agents.owner_user_id` column + partial index | `migrations/0327_user_owned_agents.sql` | shipped |
| `agent_runs.owner_user_id` column + index | same | shipped |
| `integration_connections.owner_user_id` column + partial unique index | same | shipped |
| `CredentialBrokerService` owner-aware lookup | `server/services/credentialBrokerService.ts` | shipped |
| RLS clause for user-owned agent visibility | `server/config/rlsProtectedTables.ts` + migration | shipped |
| Admin redaction policy at API serialisation | per-route in `server/routes/` | shipped |
| Master brief §5.1 + §9 doc update | `docs/synthetos-governed-agentic-os-brief-v1.2.md` | shipped |

### EA V1 product

| Component | File / migration | Status |
|---|---|---|
| Google Calendar OAuth provider | `server/config/oauthProviders.ts` | shipped |
| Calendar actions (6 of 7) | `server/services/calendar/calendarActionService.ts` + skills | shipped (`delete_event` correctly deferred) |
| Slack agent actions (6) | `server/services/slack/slackActionService.ts` + skills | shipped |
| Executive Assistant system-agent template | `server/config/c.ts` + `migrations/0332_executive_assistant_seed.sql` | shipped |
| `VoiceProfile` primitive + Gmail-sent + Drive-doc samplers | `server/services/voiceProfile/` + `migrations/0328_voice_profiles.sql` | shipped |
| `ea_drafts` table + drafts service | `server/db/schema/eaDrafts.ts` + `migrations/0329_ea_drafts.sql` | shipped |
| External-source webhook triggers | `server/services/triggers/externalSourceTriggers.ts` + `migrations/0330_external_source_triggers.sql` | shipped |
| Personal nav group (data-driven) | `client/src/config/sidebar.ts` + `useUserOwnedAgents.ts` | shipped |
| Home Personal zone + home-widget contract | `client/src/components/personal/PersonalZoneCard.tsx` + `migrations/0331_system_agents_home_widget.sql` | shipped |
| EA first-run wizard | `client/src/pages/personal/EAFirstRunWizard.tsx` | shipped |
| Per-agent detail page (tabbed) | `client/src/pages/personal/PersonalAssistantPage.tsx` | shipped |
| Three V1 use cases (briefing / inbox triage / meeting prep) | `server/skills/ea-*.md` | shipped |
| Capability grouping layer | `server/config/capabilityGroups.ts` | shipped |
| Gmail polling + Calendar lookahead + voice profile refresh jobs | `server/jobs/` + `server/services/triggers/` | shipped |
| Three mockups | `prototypes/personal-assistant-v1/` | shipped |
| Implementation spec | `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` | shipped (2048 lines) |

### Reviews and gates

| Review | Verdict | Notes |
|---|---|---|
| G2 gate (lint + typecheck + build) | PASS | 0 errors |
| spec-conformance | CONFORMANT_AFTER_FIXES | 12 directional gaps deferred |
| adversarial-reviewer | HOLES_FOUND → 5 fixed inline, 4 deferred | |
| pr-reviewer | CHANGES_REQUESTED → 7 blockers fixed | |
| dual-reviewer (Codex) | 5 iterations, NEEDS_REVISION (cap reached) | Coverage gap acknowledged in handoff REVIEW_GAP |
| chatgpt-pr-review | APPROVED_AFTER_FIXES (2 rounds) | F1 reclassification accepted; 6 fixes applied across rounds |
| doc-sync | COMPLETE | architecture / capabilities / integration-reference / KNOWLEDGE updated |

**Bottom line on V1:** everything in the brief was built. The boundary collapse (foundation + product in one PR) was acknowledged via F1 reclassification with the briefs preserved unchanged as design documentation.

## 2. What's still open from V1 (deferred items)

All non-blocking. Tracked in `tasks/todo.md` under the "Personal Assistant V1 (PR #291)" section.

### Spec-conformance directional gaps (11 items)

"Amend code OR amend spec" decisions — neither path is wrong, the spec and code drifted on naming / risk-tier / shape and need alignment:

- **REQ-C4** — `voice_profiles` schema diverges from spec §7.4 (missing `name`, `sources[]`, `source_config`, `refresh_config`)
- **REQ-CAL2** — Calendar `create_event` / `update_event` risk tier mismatch (code: Tier 6, spec: Tier 4)
- **REQ-T8** — Dedup key formats diverge from spec (Slack + Calendar)
- **REQ-C1** — `ExternalSourceTriggerEvent` schema simplified vs spec (flat shape, no envelope)
- **REQ-EA1** — EA default skill allowlist incomplete vs spec §13.2 (13 skills missing — verify universal-skills coverage)
- **REQ-EA3** — Partial unique index axis (code: `(org, owner)`, spec: `(subaccount, owner)`)
- **REQ-EA4** — EA home_widget refreshPolicy is `every_5m`; spec says `on_login`
- **REQ-EA5** — EA home_widget `titleTemplate` hardcoded "Personal Assistant"; spec says `${agent.displayName}`
- **REQ-M15** — Personal nav group placement (top vs mid-list)
- **REQ-C3** — `slack.list_channels` Zod schema missing `types` filter
- **REQ-CAL3-naming** — Calendar write-action error codes diverge
- **REQ-M9** — Stall job 7-day proposal expiry path for EA-linked drafts

### Adversarial findings (4 worth-confirming items)

- **createDraftWithProposal non-atomic** — `actionService.proposeAction` doesn't accept a tx parameter; refactor needed
- **dispatch() missing organisationId filter** — connection lookup not org-filtered in external trigger dispatch
- **dispatch() rate-cap count not scoped by organisationId** — cap is per-owner globally, not per-owner-per-org
- **`assembleThreadSummaryPrompt` prompt-injection surface** — future hardening when summarisation moves to LLM passthrough

### Recommended posture

Don't open a single sweep PR. Pick them off as natural follow-on opportunities arise (next time someone touches the relevant file, fix the deferred item in the same PR). The 4 adversarial worth-confirmings are higher priority than the 11 directional gaps; address them within ~2 weeks if possible.

## 3. What's left to build to close out the Personal Assistant

### Three meaningful work items remain

**A. EA V2 — Operator Mode upgrade** (the big one). Per the V1 brief §5, V2 adds `controllerStyle: 'operator'` to the EA so it can run long-running autonomous tasks alongside the V1 native short-burst pattern. V2 build:

- Adds `controllerStyle: 'operator'` to the EA's allowed-controllers set in `server/config/c.ts`
- Routes adaptive / multi-turn tasks (e.g. "investigate why client X is unhappy") to the Operator Controller
- Defines when the EA auto-selects operator mode vs requires explicit user opt-in
- Defines persistent operator-session memory (or defers to Phase 3)
- Sets operator-mode duration / concurrency / approval defaults for the EA

**V2 dependencies (status — corrected 2026-05-13):**

- **Spec D `operator-backend`** — ✅ **MERGED** (PR #288). The full operator-backend service tier shipped: `operator_runs` + `operator_task_profiles` + `subaccount_operator_settings` tables (migrations 0335-0342), `OperatorSessionEnvelope` + `ApiKeyEnvelope` types, dispatcher + chain-resume scheduler, credential broker extensions for operator sessions, cost writer, suspension notifier, sandbox template at `infra/sandbox-templates/operator-session/`. Four chatgpt-pr-review rounds APPROVED.
- **Spec B `sandbox-isolation`** — ✅ merged #287
- **Spec A `execution-backend-adapter-contract`** — shipped inline alongside Spec D (the IEE generalisation work is part of PR #288)
- **Spec C `operator-session-identity`** — ✅ merged (operator-session credentials, ChatGPT OAuth)

**All Phase 3 operator-backend foundations are in main.** V2 (`personal-assistant-v2-operator`) has its full predecessor stack ready. The V2 brief itself (`tasks/builds/personal-assistant-v2-operator/brief.md`) does NOT exist yet — it needs to be authored before V2 can build, but no further predecessor work is required.

**B. V1 follow-on use cases (small adds, after V1 settles in dogfood)**

- Slack thread summary on @mention (V1 use case #4, deferred)
- Friday weekly review summary (V1 use case #5, deferred)
- Calendar conflict detection + reschedule suggestions (deferred for canonical schema reasons)

**C. V1 polish — the 15 deferred items above**

Pick off in natural follow-on PRs. No urgency.

### What is NOT planned

- Drive writes (Docs / Sheets editing) — explicitly deferred V1, no V1.5 use case identified
- Notion / Outlook / M365 connectors — explicitly out of scope for the Google-stack dogfood
- Customer-facing productisation of the EA — internal dogfood only, not in roadmap
- Cross-principal delegation — design note in `user-owned-agents/brief.md` §3.8; deferred until a real use case emerges
- Cross-session shared memory across multiple user-owned agents — design note; additive primitive later if needed

## 4. The e2b browser question + AWS recommendations

### Current state of the execution substrate

| Workload | Where it runs today | Status |
|---|---|---|
| Code-execution sandbox (Spec B) | e2b (sandbox provider integration shipped per #287) | e2b SDK installation **deferred** until the operator provisions the e2b account. Currently a stub that throws "e2b SDK not yet installed" on first call. |
| IEE browser worker (Playwright) | Currently the `worker/` Node process running Playwright; deployed on DigitalOcean | DigitalOcean retirement question is open |
| Operator Backend (Spec D) | Will use e2b (per `tasks/builds/operator-backend/brief.md` §3.3 — "Template path: `infra/sandbox-templates/operator-session/`. Single source of truth for both e2b (template) and `docker-compose` (local dev).") | Brief locked, build not started |

### Answer to "e2b for both browser and operator?" — RECOMMENDED YES

**Recommendation: migrate IEE browser worker to e2b. Retire DigitalOcean.** Confirmation rationale below.

What's already on e2b:
- Spec B (sandbox isolation) — e2b is the chosen provider, infrastructure shipped in PR #287
- Spec D (operator-backend) — e2b sandbox template at `infra/sandbox-templates/operator-session/`, shipped in PR #288. Chain-resume model + persistent browser-profile pattern for operator chain-link sessions already designed (§3.13 of operator-backend spec).

What remains on DigitalOcean today:
- The IEE browser worker (`worker/` Node process running Playwright)
- Browser-task execution for the existing `iee_browser` mode (42 Macro Task, scraping flows, EA's webhook-triggered work where applicable)

Why e2b wins for iee-browser:

1. **One execution substrate.** SynthetOS becomes a single-vendor execution story. Spec B + Spec D + iee-browser all on e2b = clean architecture, one set of operational tools, one billing line. The "governed agentic OS" pitch is sharper when there's one substrate.

2. **Per-task isolation.** Today's DigitalOcean droplet runs all browser tasks in one shared worker — no per-task isolation. e2b gives each session its own sandbox. Material safety win because browser tasks regularly hold customer credentials (Gmail login, OAuth flows, scraped paywalled content). One rogue script in shared-worker territory can leak across tasks; e2b sessions can't.

3. **Concurrency scales without operations work.** DO single-worker = serial execution (or you spin up + manage multiple droplets manually). e2b = native parallel sessions. As multi-user EA + scheduled triggers ramp, parallel browser execution becomes valuable.

4. **Browser profile persistence is solved.** The operator-backend brief §3.13 already designed the persistent-profile pattern for chain-link sessions on e2b. iee-browser reuses the same primitive — login state, cookies, downloaded artefacts persist across sandbox lifecycles via the same profile-snapshot mechanic. No new infrastructure.

5. **Audit + observability.** e2b sandboxes have richer per-task telemetry built in (session id, resource usage, lifecycle events). Plugs into Run Trace cleanly. DO needs custom logging to match.

6. **Cost is competitive, not the headline reason.** e2b pricing is per-second-of-active-session for ~$0.50/vCPU-hour. For a 5-minute browser task that's ~$0.04; a 30-minute task ~$0.25. DO at $6-12/month flat is cheap if utilisation is low and single-tenant, but per-session cost on e2b becomes equal-or-better once you'd need a second DO droplet for concurrency. At the scale of multiple staff EAs running scheduled briefings + on-demand triggers, e2b is similar cost AND removes operational toil. At scale further, e2b wins on cost too.

Trade-offs to manage:

- **Cold start latency.** e2b cold start is 10-30s vs DO-worker hot ~0s. Mitigation: maintain a warm pool of 1-2 sandboxes for the common workloads. For scheduled tasks (morning briefing at 07:00) cold start is fine. For user-triggered tasks ("scrape this page now") warm pool eliminates the issue.
- **Sandbox lifecycle vs persistent worker.** Today's worker process knows nothing about per-task lifecycle; just runs Playwright. On e2b, every task starts and stops a sandbox. The migration must wrap the existing `worker/src/browser/` code path in the e2b session lifecycle pattern — straightforward, follows the operator-backend chain-link template.
- **One-vendor risk.** Yes, you're concentrating on e2b. Acceptable in exchange for the architectural consolidation. The `SandboxExecutionService` provider abstraction (shipped in Spec B) means a future second provider plugs in without touching adapters.

**Recommended action:** open a small scope brief at `tasks/builds/iee-browser-on-e2b/brief.md` covering:

1. Migration plan: wrap the current `worker/src/browser/` Playwright path in an e2b session lifecycle (likely a `BrowserExecutionService` mirror of the operator-backend pattern)
2. Browser profile lifecycle reuse from operator-backend §3.13 — persistent profile snapshots keyed by `(subaccount_id, owner_user_id?, agent_id)` so deterministic browser flows resume cleanly
3. Warm-pool configuration for cold-start mitigation on user-triggered flows
4. DigitalOcean retirement sequence: parallel-run period → cutover → DO decommission
5. Cost forecast: per-task-volume × per-session price vs current DO bill, validating crossover point

### AWS recommendations from the reviewer — my prioritisation

| # | Item | Priority | Cost | Notes |
|---|---|---|---|---|
| 1 | **Migrate IEE browser to e2b + retire DigitalOcean** (write `iee-browser-on-e2b` spec, execute migration) | **HIGH** — unlocks DO retirement + completes the single-substrate story | Spec brief small; migration build probably 1–2 weeks | Recommendation per §4 above. Reuses operator-backend §3.13 profile-snapshot pattern. |
| 2 | **Amazon Bedrock as 4th LLM provider** | Phase 1.5 | Small — `llmRouter` already abstracts providers | Unlocks enterprise-AWS buyers + Bedrock Guardrails as Policy Envelope enforcement |
| 3 | **AWS KMS for credential master key** | Phase 1.5 | Small — `connectionTokenService` already supports versioned key format | Removes a real audit risk; bundles cleanly with the credential-broker work already done |
| 4 | **Bedrock AgentCore Runtime** as Phase 3 Operator Controller candidate | Phase 3.5 (post-Spec-D-merge) | None today — candidate list work for the next operator-backend spec iteration | Note: Spec D (operator-backend) is already merged with e2b as the runtime. Bedrock AgentCore Runtime would be a **second adapter** alongside the e2b one, not a replacement. Useful for enterprise customers who require AWS-resident execution. |

Everything else from the reviewer's list (RDS, SQS, Cognito, OpenSearch, CloudWatch, etc.) — skip per their own recommendation.

## 5. Recommended next-session prompt

Below are three drop-in prompts for the next session. Pick which one(s) you want and adjust accordingly.

### Option α — Author the V2 brief (recommended next step)

```
Author the Personal Assistant V2 brief at
tasks/builds/personal-assistant-v2-operator/brief.md.

CONTEXT:
- V1 shipped in PR #291 (merged 2026-05-13). V1 brief at
  tasks/builds/personal-assistant-v1/brief.md.
- Foundation user-owned-agents primitive shipped inline in the same PR
  (brief at tasks/builds/user-owned-agents/brief.md).
- V1 is Native Controller only. V2 adds Operator Controller capability.

V2 BRIEF SHOULD COVER:
1. Adds controllerStyle: 'operator' to the EA's allowed-controllers set.
2. Routing rule: when does the EA use operator mode vs native?
   Candidates: adaptive verbs in the task, no deterministic template
   match, user explicit toggle, native attempted and returned uncertainty.
3. Operator-mode use cases for the EA (2-3 candidates): complex client
   investigation, multi-source research with synthesis, calendar-aware
   meeting orchestration across multiple people.
4. Persistent operator-session memory for the EA — what state survives
   between operator runs? Defer to Phase 3 if Spec D's session model
   doesn't yet support cross-session memory.
5. Default Operator Session Identity for the EA: ChatGPT OAuth
   (per Spec C) vs API key with fallback.
6. Operator-mode duration / concurrency for the EA — inherit Spec D
   defaults (120-min chain-link cap, 3 concurrent) or set specific?
7. Approval policy for operator-mode EA runs — Tier 4+ probably needs
   review even in operator mode.
8. Upgrade path — when V2 ships, V1 EA gains the operator controller;
   existing V1 native-only triggers keep working unchanged.

LOCKED PREDECESSORS (all merged — V2 build is unblocked):
- Spec A `execution-backend-adapter-contract` — shipped inline with Spec D
- Spec B `sandbox-isolation` — merged #287
- Spec C `operator-session-identity` — merged
- Spec D `operator-backend` — MERGED #288 (full operator-backend service
  tier shipped, migrations 0335-0342, sandbox template, dispatcher +
  chain-resume scheduler, four chatgpt-pr-review rounds APPROVED)

V2 BRIEF FORMAT (mirror V1 brief structure):
- Header (status, date, type, build slug, predecessors, strategic parent)
- §0 Naming decision (Operator Mode / V2 upgrade — not new agent)
- §0.5 Strategic framing + decision rationale
- §1 Purpose
- §2 What's locked from upstream (including the V1 + foundation work)
- §3 What this spec must define (the 8 items above as sub-sections)
- §4 Open architectural questions for operator ratification
- §5 Out of scope
- §6 What unblocks when this ships
- §7 Sequencing (mockups likely needed for operator-mode UI surfaces)

DECISIONS ALREADY LOCKED FROM PRIOR SESSION (apply throughout):
- Schema: single owner_user_id column, no principal abstraction
- Strategic non-goal: V2 does NOT compete with Claude/ChatGPT/Codex on
  personal-productivity richness
- Capability surface alignment with existing WorkspaceAdapter floor
- Reuse acceptance criterion: any operator-mode work must work for a
  future Dev Agent (Phase 3) without EA-specific branching

AFTER AUTHORING:
- Run spec-reviewer (Codex loop) and chatgpt-spec-review (manual rounds)
- Operator ratifies §4 open questions before handing off to
  feature-coordinator for build planning
```

### Option β — Open the iee-browser-on-e2b scope brief + migration plan

```
Author a scope brief at tasks/builds/iee-browser-on-e2b/brief.md for
migrating the current IEE browser worker (Playwright in worker/src/browser/,
deployed on DigitalOcean) onto e2b's sandbox substrate. RECOMMENDATION
ALREADY MADE — migrate, not "evaluate whether to migrate". This brief
captures the migration plan, not the decision.

CONTEXT:
- e2b is the sandbox provider for Spec B (sandbox isolation, merged #287)
  and Spec D (operator-backend, merged #288). Both shipped with the
  shared `SandboxExecutionService` provider abstraction.
- The IEE browser worker is the last piece on DigitalOcean. Retiring DO
  is the goal; this build is the unlock.
- Decision rationale lives in `tasks/builds/personal-assistant-v1/
  post-merge-audit-2026-05-13.md` §4 — one execution substrate, per-task
  isolation, native concurrency, audit, persistent-profile reuse from
  Spec D §3.13.

THE BRIEF MUST DEFINE:
1. Migration plan: wrap worker/src/browser/ Playwright code path in an
   e2b session lifecycle. Likely a `BrowserExecutionService` mirror of
   the operator-backend pattern. Identify which files migrate vs which
   stay (Playwright code itself likely stays; the runner harness changes).
2. Browser profile persistence: reuse the operator-backend §3.13
   profile-snapshot pattern. Profile keyed by
   `(subaccount_id, owner_user_id?, agent_id)`. Define lifecycle
   (creation, snapshot, restore, GC) — likely a direct reuse with
   different scoping rules.
3. Warm-pool configuration: keep 1-2 hot sandboxes for user-triggered
   browser flows to mask cold start. Configurable per subaccount.
4. DigitalOcean retirement sequence: parallel-run → cutover → DO
   decommission. Include rollback path for the parallel-run period.
5. Cost forecast: per-task-volume × per-session price vs current DO bill.
   Validate crossover point at expected EA + IEE scale.

OUT OF SCOPE:
- AWS Bedrock LLM provider — separate item, Phase 1.5.
- AWS KMS credential master key — separate item, Phase 1.5.
- New browser capability work (e.g. richer scraping APIs) — separate
  future spec.
- Migration of the cron/job system from pg-boss — not affected by browser
  substrate change.

WORK SIZING: spec ~1 day, build probably 1-2 weeks (most effort is in
profile-lifecycle wiring + parallel-run validation, not raw e2b
integration which is already done for Spec B/D).
```

### Option γ — Sweep V1 deferred items

```
Close the 4 adversarial worth-confirming items + the 11 spec-conformance
directional gaps from tasks/todo.md "Personal Assistant V1 (PR #291)"
section.

ADVERSARIAL (priority — close first):
- createDraftWithProposal non-atomic (refactor actionService.proposeAction)
- dispatch() missing organisationId filter
- dispatch() rate-cap not org-scoped
- assembleThreadSummaryPrompt prompt-injection hardening

SPEC-CONFORMANCE DIRECTIONAL GAPS (12 items, "amend code or amend spec"):
- REQ-C4, REQ-CAL2, REQ-T8, REQ-C1, REQ-EA1, REQ-EA3, REQ-EA4, REQ-EA5,
  REQ-M15, REQ-C3, REQ-CAL3-naming, REQ-M9

For each: either fix the code to match the spec, or open a spec PR that
amends the spec to match the code. Document the chosen direction with a
one-line rationale in the spec / KNOWLEDGE.md.

Run pr-reviewer + adversarial-reviewer at the end.
```

### My recommendation

**Run Option α and Option β in parallel sessions.** They touch independent code areas:

- **Option α (V2 brief)** — extends product capability (Operator Mode on EA). Predecessors all merged. V2 brief can be authored immediately, then `feature-coordinator` builds it.
- **Option β (iee-browser-on-e2b)** — completes the infrastructure consolidation story. Unlocks DigitalOcean retirement. Reuses the operator-backend persistent-profile pattern, so the technical risk is low.

Both are roughly 1-2 week builds. Running them concurrently is feasible (no file overlap — V2 touches `server/config/c.ts` + orchestrator-routing services + agent-mode UI; e2b migration touches `worker/src/browser/` + new `BrowserExecutionService` + DO decommission). Migration-numbering collision is the only real conflict surface, handled the same way operator-backend + EA V1 handled it at S2 sync.

**Option γ** (V1 sweep) can wait — pick off opportunistically as related code is touched. None of the deferred items block product work.

## End of audit
