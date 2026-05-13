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

**V2 dependencies (status check needed):**

- **Spec D `operator-backend`** — brief locked but build NOT done. The runtime that consumes Spec A (adapter contract), Spec B (sandbox isolation, ✅ merged #287), Spec C (operator-session identity) end-to-end.
- **Spec A `execution-backend-adapter-contract`** — adapter contract; verify status.
- **Spec C `operator-session-identity`** — operator-session credentials (ChatGPT OAuth); verify status.

The V2 brief itself (`tasks/builds/personal-assistant-v2-operator/brief.md`) does NOT exist yet. It needs to be authored before V2 can build.

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

### Answer to "e2b for both browser and operator?"

**Architecturally yes, but not yet decided / documented as a hard call.**

What the briefs say:
- Spec B (sandbox) uses e2b — locked.
- Spec D (operator-backend) uses e2b — locked.
- The current IEE browser worker (Playwright on DigitalOcean) — **not addressed** in any brief. This is the open question your AWS reviewer flagged.

What e2b supports today: e2b has a browser sandbox product. Technically the IEE browser worker could be migrated onto e2b, which would unify the execution substrate.

What's blocking the decision: nobody has explicitly written the spec saying "iee_browser worker migrates from DigitalOcean to e2b" with the cost / latency / browser-profile-persistence implications. The operator-backend brief §3.13 mentions persistent browser profiles for operator chain-link sessions, but that's the Phase 3 operator pattern, not the Phase 2 deterministic browser worker.

**Recommendation:** open a small spec brief — something like `iee-browser-on-e2b` — that explicitly answers:

1. Can e2b browser sandboxes host the current Playwright workflow at acceptable latency / cost?
2. Does the existing browser-profile lifecycle work on e2b (cookies, login state, downloads)?
3. Migration plan from `worker/` Node process → e2b sandbox-based browser execution
4. DigitalOcean retirement sequence

If the answer is yes to (1) and (2), DigitalOcean retires and SynthetOS has zero AWS dependency for execution substrate. If no, fall back to AWS Fargate or Bedrock AgentCore Browser Tool (the reviewer's other options).

### AWS recommendations from the reviewer — my prioritisation

| # | Item | Priority | Cost | Notes |
|---|---|---|---|---|
| 1 | **Confirm e2b covers browser sessions** (write the `iee-browser-on-e2b` spec) | **URGENT** — blocks DO retirement | Small spec, decision artifact only | Most important item; everything else can wait |
| 2 | **Amazon Bedrock as 4th LLM provider** | Phase 1.5 | Small — `llmRouter` already abstracts providers | Unlocks enterprise-AWS buyers + Bedrock Guardrails as Policy Envelope enforcement |
| 3 | **AWS KMS for credential master key** | Phase 1.5 | Small — `connectionTokenService` already supports versioned key format | Removes a real audit risk; bundles cleanly with the credential-broker work already done |
| 4 | **Bedrock AgentCore Runtime** as Phase 3 Operator Controller candidate | Phase 3 | None today — candidate list work for Spec D | Add to the Operator Controller backend candidate set alongside OpenClaw + future internal backend |

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

LOCKED PREDECESSORS (must merge before V2 build):
- Spec A `execution-backend-adapter-contract` — verify status
- Spec B `sandbox-isolation` — merged #287
- Spec C `operator-session-identity` — verify status
- Spec D `operator-backend` — BRIEF LOCKED at
  tasks/builds/operator-backend/brief.md, BUILD NOT STARTED

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

### Option β — Open the e2b-browser spec (urgent if DigitalOcean retirement matters)

```
Author a small scope brief at tasks/builds/iee-browser-on-e2b/brief.md
answering whether the current IEE browser worker (Playwright on
DigitalOcean today, in worker/src/browser/) can migrate onto e2b's
browser sandbox product.

CONTEXT:
- e2b is the chosen sandbox provider for Spec B (sandbox isolation,
  merged #287) and Spec D (operator-backend, brief locked).
- The current IEE browser worker is a separate Node process running
  Playwright. Deployment platform retirement (DigitalOcean) is on the
  roadmap. Without a browser substrate decision, retirement is blocked.

THE BRIEF MUST ANSWER:
1. Does e2b's browser sandbox product support the existing Playwright
   workflow used by worker/src/browser/?
2. Latency / cost comparison: e2b browser sandboxes vs current DO setup.
3. Browser-profile lifecycle (cookies, login state, downloads,
   contractEnforcedPage / observability) — does it survive on e2b?
4. Migration plan if yes — sequence + tests + cutover.
5. Fallback if no — AWS Fargate or Bedrock AgentCore Browser Tool;
   trade-offs.

OUT OF SCOPE:
- The operator-backend Phase 3 browser pattern (persistent profile
  across chain-link sessions) — owned by Spec D §3.13.
- AWS Bedrock LLM provider — separate item.
- AWS KMS credential master key — separate item.
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

**Run Option α first** (V2 brief authoring) — it's the natural continuation of the Personal Assistant work and is the only path that meaningfully extends the product's capability. Verify Spec A and Spec C status before authoring; if they're not merged yet, the V2 brief still gets written but the build sequencing will note them as locked predecessors.

**Then Option β** (e2b browser spec) — important infrastructure decision but doesn't extend product capability. Lower priority unless DigitalOcean retirement is time-sensitive.

**Option γ** (sweep) can wait — pick off opportunistically as related code is touched. None of the deferred items block product work.

## End of audit
