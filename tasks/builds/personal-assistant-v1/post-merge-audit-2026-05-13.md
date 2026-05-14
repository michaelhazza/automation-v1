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
- [Operator clarification (2026-05-13, post-audit)](#operator-clarification-2026-05-13-post-audit)

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

- **Spec D `operator-backend`** — MERGED (PR #288). The full operator-backend service tier shipped: `operator_runs` + `operator_task_profiles` + `subaccount_operator_settings` tables (migrations 0335-0342), `OperatorSessionEnvelope` + `ApiKeyEnvelope` types, dispatcher + chain-resume scheduler, credential broker extensions for operator sessions, cost writer, suspension notifier, sandbox template at `infra/sandbox-templates/operator-session/`. Four chatgpt-pr-review rounds APPROVED.
- **Spec B `sandbox-isolation`** — merged #287
- **Spec A `execution-backend-adapter-contract`** — shipped inline alongside Spec D (the IEE generalisation work is part of PR #288)
- **Spec C `operator-session-identity`** — merged (operator-session credentials, ChatGPT OAuth)

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
| Code-execution sandbox (Spec B) | e2b (sandbox provider integration shipped per #287) | e2b SDK installation deferred until the operator provisions the e2b account. Currently a stub that throws "e2b SDK not yet installed" on first call. |
| IEE browser worker (Playwright) | Currently the `worker/` Node process running Playwright; deployed on DigitalOcean | DigitalOcean retirement question is open |
| Operator Backend (Spec D) | Will use e2b (per `tasks/builds/operator-backend/brief.md` §3.3 — Template path: `infra/sandbox-templates/operator-session/`. Single source of truth for both e2b (template) and `docker-compose` (local dev).) | Brief locked, build not started |

### Answer to "e2b for both browser and operator?" — RECOMMENDED YES

**Recommendation: migrate IEE browser worker to e2b. Retire DigitalOcean.**

What's already on e2b:
- Spec B (sandbox isolation) — e2b is the chosen provider, infrastructure shipped in PR #287
- Spec D (operator-backend) — e2b sandbox template at `infra/sandbox-templates/operator-session/`, shipped in PR #288. Chain-resume model + persistent browser-profile pattern for operator chain-link sessions already designed (§3.13 of operator-backend spec).

What remains on DigitalOcean today:
- The IEE browser worker (`worker/` Node process running Playwright)
- Browser-task execution for the existing `iee_browser` mode

Why e2b wins for iee-browser:

1. **One execution substrate.** Spec B + Spec D + iee-browser all on e2b = clean architecture, one set of operational tools, one billing line.
2. **Per-task isolation.** Today's DigitalOcean droplet runs all browser tasks in one shared worker. e2b gives each session its own sandbox. Material safety win.
3. **Concurrency scales without operations work.** e2b = native parallel sessions.
4. **Browser profile persistence is solved.** Reuses operator-backend §3.13 profile-snapshot mechanic.
5. **Audit + observability.** e2b sandboxes have richer per-task telemetry built in.
6. **Cost is competitive.** Per-session cost on e2b becomes equal-or-better once concurrency demands a second DO droplet.

Trade-offs to manage:

- **Cold start latency** (~10-30s) — mitigated by a warm pool.
- **Sandbox lifecycle vs persistent worker** — straightforward migration via the operator-backend chain-link template.
- **One-vendor risk** — acceptable given the `SandboxExecutionService` provider abstraction shipped in Spec B.

**Recommended action:** open a small scope brief at `tasks/builds/iee-browser-on-e2b/brief.md` covering migration plan, profile lifecycle reuse, warm pool, DO retirement sequence, and cost forecast.

### AWS recommendations from the reviewer — my prioritisation

| # | Item | Priority | Cost | Notes |
|---|---|---|---|---|
| 1 | Migrate IEE browser to e2b + retire DigitalOcean | HIGH | Spec brief small; migration build probably 1-2 weeks | Reuses operator-backend §3.13 profile-snapshot pattern. |
| 2 | Amazon Bedrock as 4th LLM provider | Phase 1.5 | Small | Unlocks enterprise-AWS buyers + Bedrock Guardrails. |
| 3 | AWS KMS for credential master key | Phase 1.5 | Small | Removes a real audit risk. |
| 4 | Bedrock AgentCore Runtime as Phase 3 Operator Controller candidate | Phase 3.5 | None today | Would be a second adapter alongside the e2b one. |

Everything else from the reviewer's list (RDS, SQS, Cognito, OpenSearch, CloudWatch, etc.) — skip per their own recommendation.

## 5. Recommended next-session prompt

Three drop-in prompt options were drafted (Option α — V2 brief; Option β — iee-browser-on-e2b brief; Option γ — V1 deferred-items sweep). The operator selected Option β; this audit's §4 decision proceeds via the `iee-browser-on-e2b` brief at `tasks/builds/iee-browser-on-e2b/brief.md`.

## Operator clarification (2026-05-13, post-audit)

**DigitalOcean was never actually launched.** The product is still in development. The IEE browser worker exists in the repo (`worker/Dockerfile`, `worker/src/browser/`) and was designed for a DigitalOcean VPS, but no production VPS was ever provisioned, no production traffic ever ran on DO, and no DO bill exists.

**Implications for the `iee-browser-on-e2b` brief:**

- This is NOT a "migration with retirement of an existing system." It's "redirect the unlaunched IEE browser path to e2b before first launch, and remove the DO-bound code paths from the repo."
- No parallel-run / shadow window is needed. There's no DO production traffic to compare against.
- No DO infrastructure decommission is needed. There's no infrastructure to tear down.
- The brief's §3.5 (parallel-run validation), §3.6 (DO retirement), and §3.7 (cost forecast vs DO baseline) are all reframed accordingly.
- Cost-tracking is observation-based, not forecast-vs-baseline. e2b is the substrate; per-task and per-subaccount cost is measured from day one and alarms fire if it goes off-script.

## End of audit
