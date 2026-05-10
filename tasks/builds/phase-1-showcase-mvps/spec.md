# Phase 1 Showcase MVPs — Implementation Spec

**Status:** reviewing
**Spec date:** 2026-05-10
**Last updated:** 2026-05-10
**Author:** michaelhazza (operator) + spec-coordinator + spec-reviewer
**Build slug:** `phase-1-showcase-mvps`
**Branch:** `claude/phase-1-showcase-mvps-{tbd}`
**Authoritative brief:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` Section 18.1 (Phase 1 showcase MVPs)
**Predecessor specs (already built and merged):**
- `tasks/builds/synthetos-foundation-refactor/spec.md` — Foundation refactor (BUILT, PR #279)
- `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` — Support Desk Canonical (BUILT and MERGED; canonical_tickets / canonical_ticket_messages / canonical_ticket_drafts / canonical_inboxes / canonical_support_agents schemas, migrations 0307-0312, 10 `support.*` skill specs, 8 support services, support route group, 8 support UI components all in place)
**Reviewers required:** spec-reviewer (Codex loop), architect (sign-off), pr-reviewer at implementation, dual-reviewer if local Codex available

This spec covers the two Phase 1 showcase MVPs defined in `docs/synthetos-governed-agentic-os-brief-v1.2.md` Section 18.1:

1. **42 Macro Task (Full MVP)** — deterministic browser automation, mostly built today, requires polish and production hardening.
2. **Support Inbox Workflow (Triage + Drafts + Approval)** — exercises Native Controller plus light Operator escalation, plus the existing HITL plus Slack approval flow; runs on top of the Support Desk Canonical layer.

Each MVP is substantively different: 42 Macro is a polish-and-harden exercise on existing browser automation; Support Inbox is the agent layer that consumes the canonical support data layer. They share some infrastructure (file delivery, approval UX) but build independently after the foundation lands.

---

## Contents

- [0. Status, Scope, Anchors](#0-status-scope-anchors)
- [1. Background and Motivation](#1-background-and-motivation)
- [2. Goals and Non-Goals](#2-goals-and-non-goals)
- [3. Constraints and Invariants](#3-constraints-and-invariants)
- [4. 42 Macro Task Full MVP](#4-42-macro-task-full-mvp)
  - [4.1 Current state](#41-current-state)
  - [4.2 Target state](#42-target-state)
  - [4.3 Gap design — file delivery](#43-gap-design--file-delivery)
  - [4.4 Gap design — PDF report generation](#44-gap-design--pdf-report-generation)
  - [4.5 Gap design — artifact viewer UI](#45-gap-design--artifact-viewer-ui)
  - [4.6 Production hardening](#46-production-hardening)
- [5. Support Inbox Showcase MVP](#5-support-inbox-showcase-mvp)
  - [5.1 Dependencies and current state](#51-dependencies-and-current-state)
  - [5.2 Target state](#52-target-state)
  - [5.3 Agent design](#53-agent-design)
    - [5.3.4 Per-ticket concurrency guard](#534-per-ticket-concurrency-guard-atomic-claim)
    - [5.3.5 Why Native Controller, not Operator](#535-why-this-is-native-controller-not-operator)
  - [5.4 Skills and execution flow](#54-skills-and-execution-flow)
  - [5.5 Eval and quality harness](#55-eval-and-quality-harness)
  - [5.6 UI surfaces](#56-ui-surfaces)
- [6. Shared Infrastructure](#6-shared-infrastructure)
- [7. Test Strategy](#7-test-strategy)
- [8. Rollout Plan](#8-rollout-plan)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Risk Register](#10-risk-register)
- [10.5 Deferred Items](#105-deferred-items)
- [11. Open Decisions](#11-open-decisions)

---

## 0. Status, Scope, Anchors

### 0.1 What this spec is

The implementation spec for the two Phase 1 showcase MVPs. It defines code changes, schema additions, UI work, tests, rollout, and acceptance criteria for both MVPs in one document. The two MVPs build in parallel after their dependencies land.

### 0.2 What this spec is not

This is not the foundation refactor spec (already locked, built, merged in PR #279). This is not the Support Desk Canonical spec (already locked, built, merged 2026-05-10). This is not the Phase 1.5 use case fan-out spec (Revenue Ops, Research, Paid Ads). This is not a Phase 2 sandbox or Phase 3 autonomous-operator spec.

### 0.3 Authority

Where this spec contradicts the v1.2 brief, the v1.2 brief is authoritative for **what** and this spec is authoritative for **how**. Where this spec depends on the Support Desk Canonical layer, that spec is authoritative; this spec consumes it. Where this spec contradicts the foundation refactor, this spec defers (foundation primitives are locked).

### 0.4 Companion artefacts

| Artefact | Location | Purpose |
|---|---|---|
| v1.2 master brief | `docs/synthetos-governed-agentic-os-brief-v1.2.md` | Phase 1 scope and showcase MVP definitions |
| Foundation refactor spec | `tasks/builds/synthetos-foundation-refactor/spec.md` | Locked primitives this MVP consumes |
| Support Desk Canonical spec | `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` | Locked canonical layer the Support Inbox MVP consumes (built and merged) |
| Naming glossary | `docs/synthetos-nomenclature.md` | Canonical names for foundation primitives |

### 0.5 Naming convention

This spec follows `docs/synthetos-nomenclature.md`. Where a v1.2 brief term differs from a code-level name, the glossary applies. Specifically: "Native Controller" maps to `controllerStyle: 'native'`; "Approval Level" derives from "Risk Tier" plus Policy Envelope; "IEE Execution Plane" includes today's `iee_browser` and `iee_dev` workers.

### 0.6 Sequencing within Phase 1

| Block | Predecessor | Status | Effort |
|---|---|---|---|
| Foundation refactor | none | DONE (PR #279) | (shipped) |
| Support Desk Canonical | Foundation refactor | DONE (canonical schema, services, skills, routes, UI components all merged) | (shipped) |
| File delivery infrastructure (this spec §6) | Foundation refactor | NOT STARTED | 8 to 12 dev-days |
| 42 Macro Full MVP (this spec §4, excludes shared file delivery) | File delivery infrastructure | NOT STARTED; ~70% built before this spec | 15 to 24 dev-days |
| Support Inbox MVP (this spec §5) | Support Desk Canonical (now done) + Foundation refactor | NOT STARTED | 18 to 28 dev-days (lower than original estimate because canonical layer is complete) |
| Phase 1 lock-in | Both showcase MVPs | NOT STARTED | 1 week |

**Sequencing posture (resolves the apparent "build in parallel" / "file delivery is a gating dependency" contradiction).** File delivery (§6) is a hard predecessor to the customer-facing surface of 42 Macro and to any Support Inbox feature that delivers customer-visible attachments. Concretely:

- **Phase A (serial, ~1 to 2 weeks).** File delivery infrastructure ships first — the schema, `fileDeliveryService`, the worker upload path (§6.1.4), and the read endpoint. Both MVPs are blocked on §6 reaching a "ready for consumers" state (the schema is in main, the service interface is stable, S3 IAM is in place). Build work on the MVPs that does NOT depend on file delivery (Support Agent classification skill + cache-decision-pending; 42 Macro's existing browser run path) MAY run in parallel with §6, but neither MVP closes its acceptance criteria until §6 is consumable.
- **Phase B (parallel, ~3 to 5 weeks).** Once §6 is consumable, the two MVPs proceed independently and can land in either order. They share §6 but have no other cross-dependencies.

This is the canonical reading of §0.6 and §8.1. Where prior wording said "build in parallel," that applies to Phase B; Phase A is serial on §6.

The two showcase MVPs can build in parallel once their dependencies are met. File delivery infrastructure is shared and is built in Phase A first; the MVPs proceed in parallel during Phase B.

---

## 1. Background and Motivation

### 1.1 What Phase 1 promised

Per `docs/synthetos-governed-agentic-os-brief-v1.2.md` Section 18.1, Phase 1 ships:

- The foundation refactor (six primitives, BUILT)
- Two showcase MVPs that exercise the foundation across distinct architectural patterns

The showcase MVPs prove the foundation works end-to-end on real customer-facing surfaces. They are the difference between "we shipped plumbing" and "we shipped a product."

### 1.2 Why these two MVPs

- **42 Macro Task** is a deterministic browser automation reference workflow. It exercises Browser Environment, Native Controller, deterministic loop semantics, artifact production, and Run Trace surface. It is mostly built today (~70%) and requires polish + production hardening rather than new feature construction. Shipping it as Full MVP validates the foundation against existing Browser-Native execution patterns.
- **Support Inbox Workflow** exercises a hybrid pattern: Native Controller for triage and template drafting, light Operator escalation (flag-for-human via `assign + internal note`) for ambiguous cases, HITL approval for customer-facing replies, Slack Block Kit for the human-in-the-loop, Gmail-via-Teamwork for the inbound channel. It runs on the Support Desk Canonical layer (Spec B). Shipping it validates the foundation against an end-to-end agent workflow that touches every layer.

Together they cover: deterministic vs structured-with-escalation execution; Browser vs API+Tool environments; auto-approve vs HITL approval; one-shot artifact production vs ongoing inbox monitoring. Both MVPs run as Native Controller throughout Phase 1; Operator Controller is Phase 3.

### 1.3 What is already in place from the foundation refactor

- `agent_runs.controller_style` (Native vs Operator); both MVPs run as Native throughout Phase 1; Operator Controller is Phase 3
- `agent_runs.policy_envelope_snapshot` (resolved at run start, surfaced in Run Trace UI headline)
- 138-row Risk Tier classification across the action registry; new actions in this spec inherit the convention
- `CredentialBrokerService` facade for credential issuance and audit
- Run Trace virtual view across the 7 ledger tables; both MVPs surface decisions and approvals through it
- Naming glossary (`docs/synthetos-nomenclature.md`)
- New UI surfaces: Run Trace headline, Agent Config tabs (Execution / Governance / Models and Identity / Integrations), Approval UX context, Credentials audit log

### 1.4 What is in the codebase already for each MVP

#### 42 Macro Task (~70% built)

Production-ready today:
- IEE browser worker with all 5 core actions (navigate, click, type, extract, download)
- Contract-enforced page abstraction with domain allowlist, MIME validation, wall-clock limits
- Web login flow with retry, screenshot audit trail, login_test mode
- `web_login` connection management UI and routes
- `iee_artifacts` table with content-hash dedup, size, MIME, inline text
- Audio and video transcription via OpenAI Whisper API (`transcribeAudioService.ts`, with cache keyed by content hash, T22 spec §4.4.1, T27 sanity floor)
- IEE progress polling on Run Trace UI

Not in place today:
- File delivery (artifacts are ephemeral in `/tmp` until worker container restarts; no S3 upload, no signed URLs, no download endpoint)
- PDF report generation (reports are markdown-only)
- Artifact viewer UI (Run Trace shows progress but has no preview, download, or share affordances)
- Production hardening (retry policy under provider rate limits; observability for stuck runs; failure-mode coverage)

#### Support Inbox Workflow (~70% built today; the support agent itself is the remaining build)

Production-ready today (foundation + Support Desk Canonical layer):
- 138-action registry with Risk Tier classification; `support.*` actions inherit it
- HITL approval flow (`actions` to `reviewItems` to `reviewAuditRecords` plus Slack Block Kit)
- Run Trace UI with controller-style and policy-envelope context
- `CredentialBrokerService` for Gmail-via-Teamwork credential injection
- Policy Envelope snapshot for replayable approval decisions
- Slack integration (`slackAdapter.ts`, `slackConversations` schema)
- `canonical_tickets`, `canonical_ticket_messages`, `canonical_ticket_drafts`, `canonical_inboxes`, `canonical_support_agents` schemas + migrations 0307-0312
- Teamwork Desk adapter with ingestion, attachment resolver, status-mapping fail-closed, three-phase dispatch
- Connector polling integration for Teamwork; webhook ingestion convergence
- 10 `support.*` skill specs in `server/skills/support/` (`add-internal-note`, `approve-draft`, `assign`, `find-customer-history`, `list-open-tickets`, `propose-reply`, `read-thread`, `reject-draft`, `set-status`, `tag`)
- 8 support services (`supportTicketService`, `supportInboxService`, `supportDraftDispatchService`, `draftCandidatesService`, `ruleCandidateDrafter`, `supportContactResolutionPure`, `supportDraftDispatchPreflightPure`, `supportDraftReconciliationPure`)
- Support route group at `server/routes/support/`
- 8 support UI components (`BackLinkAwaitingBadge`, `CollisionCallout`, `DraftOverlayMessage`, `PriorityPill`, `QuarantineBanner`, `StatusPill`, `SyncHealthPill`, `ThreadMessage`)
- `supportDraftDispatchService` with three-phase dispatch + boot recovery + reconciliation worker

Not in place today (this spec ships):
- The Support Agent itself (the agent definition: prompt, tool selection, scheduling, autonomous vs assisted-mode policy)
- LLM skill prompt templates plus result caching for the `support.*` markdown specs
- Eval / quality harness for the agent (regression set, accuracy thresholds, drift detection)
- Customer-facing tone calibration per inbox (template overrides, voice consistency)
- SLA tracking primitives (DEFERRED, not in showcase MVP scope; see Open Decisions)
- Recurring problem detection / clustering (DEFERRED)
- Knowledge base search beyond simple keyword (DEFERRED, vector search Phase 2)

### 1.5 Why before Phase 1.5

Phase 1.5 (Revenue Ops, Research Intelligence, Paid Ads Monitoring) cannot ship until the showcase MVP patterns are proven. Each Phase 1.5 use case re-uses one or more patterns from the showcase MVPs:

- Revenue Ops re-uses Support Inbox's HITL approval flow on a different inbound channel (overdue invoices instead of support tickets).
- Research Intelligence re-uses 42 Macro's deterministic browser automation plus PDF report generation on a different content source.
- Paid Ads Monitoring re-uses Support Inbox's recurrent monitoring plus recommendation pattern on a different data source (ad-platform APIs).

Shipping the showcase MVPs first proves the patterns; Phase 1.5 then fans them out across additional use cases without re-litigating architecture.

---

## 2. Goals and Non-Goals

### 2.1 Goals

**G1. Ship 42 Macro Task as a Full MVP.** Deterministic browser automation, end-to-end: log in, download latest video, transcribe, generate report, deliver artifacts to the user via downloadable file (not ephemeral worker disk), produce Run Trace surface.

**G2. Ship Support Inbox as a showcase MVP.** Support Agent that triages incoming tickets, drafts replies, routes to human approval, and sends approved replies via Teamwork Desk. Both autonomous mode (auto-approve where policy allows) and assisted mode (always require human approval) supported per inbox.

**G3. File delivery infrastructure usable across both MVPs.** S3 upload, signed URLs, download endpoint. Shared between the two MVPs and reusable for Phase 1.5 use cases.

**G4. Validate the foundation refactor in production.** The two MVPs must exercise `controllerStyle`, Risk Tier, `CredentialBrokerService`, Run Trace API, and Policy Envelope under real customer-facing conditions.

**G5. UI consistency.** Both MVPs follow the existing Operate/Build/Govern UI layout (per `consolidation-foundation`, `consolidation-operate`, `consolidation-govern` already merged). No new top-level navigation; new pages slot under existing menus.

**G6. Operator-grade observability.** Both MVPs surface their state in Run Trace, Activity, and (for Support Inbox) the Inbox surface. Failures are diagnosable from the UI, not just from logs.

**G7. Production-grade reliability for both MVPs.** Idempotent across retries, recoverable from partial failure, observable on stuck runs, gracefully degraded under provider rate limits or outages.

### 2.2 Non-Goals

**NG1. No SLA tracking primitives.** SLA definitions, response-time commitments, escalation triggers based on age, SLA breach alerts: deferred. The canonical_tickets schema already carries `sla_due_at`, `sla_breached`, `sla_policy_external_id` columns synced from the provider; this MVP treats those columns as inert provider metadata only. The Support Agent does not classify on them, alert on them, surface them in dashboards, or trigger escalations from them. Phase 1.5 or Phase 2 will add the primitives that act on those columns.

**NG2. No recurring-problem detection.** Clustering of similar tickets, "these 5 emails are all about the same bug" aggregation, vector embeddings of email bodies: deferred. Phase 2.

**NG3. No knowledge-base search in the Support Agent.** The Support Agent's default skill set does NOT include `search_knowledge_base` or `web_search` for Phase 1. Triage, classification, and drafting work from the ticket thread + customer history only. Vector search, semantic ranking, and broader knowledge-base lookup arrive in Phase 2.

**NG4. No Operator Controller for Support Inbox.** The MVP runs on Native Controller with light Operator escalation only via re-classification (the agent flags a ticket for human investigation rather than running an autonomous loop). Full Operator Controller for support investigation: Phase 3.

**NG5. No additional CRM integrations beyond what's in the codebase today.** The Support Inbox uses Teamwork Desk for tickets and Gmail-via-Teamwork for inbound. No new HubSpot, Salesforce, or Zendesk adapters in this spec.

**NG6. No Operator Session Identity.** ChatGPT OAuth as a session-based model identity: Phase 3. The posture (sanctioned-plan default + Plus-tier opt-in with disclosure + monitor) is locked in `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` Section 4 as Decision 3. The Support Inbox MVP in this spec uses platform Anthropic API only; the ChatGPT-OAuth-as-Operator-Session-Identity work is its own Phase 3 spec.

**NG7. No new product features beyond the two showcase MVPs.** Phase 1.5 use cases (Revenue Ops, Research Intelligence, Paid Ads Monitoring) are separate specs.

**NG8. No changes to foundation primitives.** `controllerStyle`, Risk Tier, `CredentialBrokerService`, Run Trace API, Policy Envelope are locked. This spec consumes them.

**NG9. No changes to Support Desk Canonical schemas or services.** The 5 canonical tables, 8 services, 10 skill specs, support route group, and 8 UI components shipped in PR #277 are locked. This spec consumes them.

**NG10. No PDF generation library proliferation.** Pick one (puppeteer or weasyprint or @react-pdf/renderer) and stick with it across both MVPs and Phase 1.5.

---

## 3. Constraints and Invariants

### 3.1 Backward compatibility

**INV-1. No regression on existing 42 Macro runs.** Today's IEE browser worker is producing real runs; the Full MVP must preserve their behaviour. Polish + production hardening means strictly additive change paths.

**INV-2. No regression on existing support-desk-canonical surfaces.** The 5 canonical tables, 8 services, 10 skill specs, support route group, and 8 UI components from PR #277 are locked. The Support Agent in this spec is a new consumer; it must not modify the canonical layer.

**INV-3. Foundation primitives are read-only from this spec.** `agent_runs.controller_style`, `agent_runs.policy_envelope_snapshot`, Risk Tier on actions, `CredentialBrokerService` API: this spec uses them, does not modify them.

**INV-4. Existing tests must continue to pass.** The full Vitest suite plus all CI gates (`verify-risk-tier-assigned.sh`, `verify-skill-read-paths.sh`, etc.) must remain green throughout.

### 3.2 Schema constraints

**INV-5. New schema only via additive columns or new tables.** No changes to existing column types, no removals, no renames. New tables for file delivery primitives are allowed.

**INV-6. RLS on every new table.** New tables registered in `server/config/rlsProtectedTables.ts`. Existing three-layer RLS pattern (Postgres policies, service-layer principal context, explicit org filters) applies.

**INV-7. Migrations reversible.** Every new migration has a `.down.sql` counterpart in `migrations/_down/`.

### 3.3 Behavioural constraints

**INV-8. Both MVPs run as Native Controller throughout Phase 1.** Per v1.2 brief Section 6.3 ("Native Controller is default. Operator Controller is escalation and adaptive mode") and Section 5.2, every Support Agent run in this MVP sets `controllerStyle: 'native'`. There is no per-task switch to `'operator'` in this spec. The "light Operator escalation" referenced in the v1.2 brief is implemented as `support.assign(human) + support.add_internal_note(reason) + a Run Trace event` — a flag-for-human, not a long-running autonomous loop. Full Operator Controller for support investigation is Phase 3 and out of scope here.

**INV-9. Approval defaults derive from Risk Tier.** Per foundation spec INV-8, this spec must not silently change the existing `gateLevel` for any action. New `support.*` actions inherit Risk Tier per the rubric in `tasks/builds/synthetos-foundation-refactor/spec.md` Section 4.2.3.

**INV-10. Customer-facing communication is Tier 6 by default.** Sending a reply to a customer (via Teamwork Desk) is Tier 6 (audience impact: client messaging). Default `gateLevel` is `block` unless explicit policy allows. Per inbox, the inbox `agent_config.mode = 'autonomous'` is the policy override that lowers approval to `auto`. **Default mode by lifecycle:** brand-new canonical_inboxes rows default to `agent_config.mode = 'disabled'` (existing schema default — the inbox is not yet wired to a Support Agent). Once the operator enables the Support Agent against an inbox, the install / enablement code path bumps the mode to `'assisted'` (HITL approval required for every customer-facing reply). The operator may then flip a single inbox to `'autonomous'` from the Inbox Agent Configuration tab (§5.6.2).

**INV-11. Three-phase dispatch for all customer-facing replies.** Per the support-desk-canonical spec §5.8, every customer-facing reply goes through preflight checks → durable transition → adapter call. The Support Agent in this spec consumes `supportDraftDispatchService.dispatchDraft` and never writes to `canonical_ticket_messages` directly.

**INV-12. File delivery is content-hashed and attributable.** Every file produced by an MVP run is stored with content hash, originating run id, and originating org id. No ephemeral files surface in customer-facing UI.

### 3.4 Process constraints

**INV-13. Both MVPs build in parallel after dependencies land.** No artificial sequencing; if the team has capacity for two parallel workstreams, run them. File delivery infrastructure may serialise the two MVPs briefly (one of them lands first; the other lands after).

**INV-14. CI gates must stay green throughout.** Same as the foundation refactor INV-15.

**INV-15. Eval harness is part of acceptance.** The Support Agent does not ship without an eval harness: a regression set of tickets, accuracy thresholds for classify/draft, drift detection. 42 Macro does not need an eval harness (deterministic).

### 3.5 Observability constraints

**INV-16. Stable log codes; Run Trace discriminators map 1:1 with log codes for events emitted from agent runs.** New log codes follow the `phase1.<area>.<event>` pattern. Events emitted from inside an agent run appear as both a structured log code AND an `agent_execution_events.event_type` discriminator with a single payload shape (the "run-rendered" set). Events emitted from non-run paths (background jobs, sweeper jobs, user HTTP requests) are log-only — they do not appear as `agent_execution_events.event_type` because there is no run-process context to attach them to.

**Canonical event registry.** Every Phase 1 event appears here exactly once. Run-rendered events double as `agent_execution_events.event_type` discriminators; log-only events surface in structured logs + the Activity feed only. All payloads are defined in `shared/types/runTraceEvents.ts` (additive Zod discriminated-union members; +120 LOC across the four areas).

| Event | Run Trace? | Activity? | Emitter | Notes |
|---|---|---|---|---|
| `phase1.macro.run_started` | yes | yes | 42 Macro agent run start | — |
| `phase1.macro.run_completed` | yes | yes | 42 Macro agent run completion | — |
| `phase1.macro.artifact_delivered` | yes | yes | `ieeRunCompletedHandler` after happy-path upload | — |
| `phase1.macro.login_failed` | yes | yes | 42 Macro browser worker on login exhaustion | — |
| `phase1.macro.run_stuck` | yes | yes | `staleMacroRunDetector` (system-monitoring) | Fires from a detector inside the run-monitoring path; run id is known. |
| `phase1.macro.report_rendering_failed` | yes | yes | `reportRenderingService` after retry exhaustion | Per §4.4.4. |
| `phase1.macro.artifact_upload_failed` | yes | yes | `fileDeliveryService.upload` (main-app) after retry exhaustion | Per §4.4.4 / §4.6.1. |
| `phase1.support.ticket_classified` | yes | yes | Support Agent classify step | Non-terminal. |
| `phase1.support.classify_failed` | yes | yes | `supportClassifyTicket` on Zod parse failure | Per §5.4.1; routes ticket to escalation. |
| `phase1.support.draft_proposed` | yes | yes | Support Agent draft step | Terminal for draft branches (§5.3.4). |
| `phase1.support.draft_dispatched` | yes | yes | `supportDraftDispatchService` per dispatch phase | Non-terminal at per-ticket level. |
| `phase1.support.draft_blocked_by_policy` | yes | yes | `supportDraftDispatchService` preflight | Non-terminal. |
| `phase1.support.collision_skipped` | yes | yes | Support Agent claim step | Terminal (§5.3.4). |
| `phase1.support.ticket_terminal` | yes | yes | Support Agent terminal verdicts | Terminal for non-draft, non-collision branches (§5.3.4). |
| `phase1.support.eval_drift_detected` | no | yes | `supportEvalDailyJob` | Not bound to a run; admin-only. |
| `phase1.file_delivery.uploaded` | no | yes | Main-app `fileDeliveryService.upload` (Option B) or finalize endpoint (Option A) | Never the worker. |
| `phase1.file_delivery.signed_url_issued` | no | yes | Main-app `fileDeliveryService.issueSignedUrl` | Includes `requestSource` discriminator. |
| `phase1.file_delivery.downloaded` | no | yes | Main-app download proxy (`GET /api/run-artifacts/:id/download`) ONLY | Never fires for direct signed-URL fetches per §6.1.5b — Copy-link downloads are unattributable by design. |
| `phase1.file_delivery.expired` | no | yes | Main-app daily sweeper (§6.1.2b) | — |

The registry is the single source of truth: §4–§6 emit events from this list only; §9 acceptance criteria reference these names verbatim; new events introduced in later phases extend this table in the same PR that ships the emitter.

**INV-17. Both MVPs surface in Run Trace.** Run Trace virtual view (foundation Item 4) already aggregates events; new event types from this spec emit through the same channels.

---

## 4. 42 Macro Task Full MVP

### 4.1 Current state

The 42 Macro Task is a deterministic browser automation reference workflow: log into a portal, download the latest video / files, transcribe the audio, generate a structured report, store artifacts, surface in Run Trace. Today's implementation is roughly 70% of a Full MVP.

**What's production-ready:**

| Component | Location | Status |
|---|---|---|
| Browser worker dispatcher | `worker/src/handlers/browserTask.ts` | Production |
| Contract-enforced page abstraction | `worker/src/browser/contractEnforcedPage.ts` | Production (domain allowlist, MIME validation, wall-clock limits) |
| 5 core browser actions | navigate, click, type, extract, download | Production |
| Web login flow with retry | `performLoginWithRetry` in `worker/src/browser/login.ts` | Production (3-attempt retry, screenshot on failure) |
| `web_login` connection management | `server/routes/webLoginConnections.ts`, `client/src/components/CredentialsTab.tsx` | Production |
| `iee_artifacts` table | content hash dedup, size, MIME, inline text, T12 UTF-8 truncation | Production |
| Audio/video transcription | `transcribeAudioService.ts` (Whisper API, content-hash cache, T22 §4.4.1, T27 sanity floor) | Production |
| IEE progress polling on Run Trace UI | foundation refactor Item 4 | Production |
| `analyse_42macro_transcript` skill spec | `server/skills/analyse_42macro_transcript.md` | Skeleton; markdown report only |
| Backoff retry helper | `withBackoff` in worker | Production |

**What's missing for Full MVP:**

1. **File delivery infrastructure** (Section 6, shared with Support Inbox). Today's artifacts are ephemeral in `/tmp` until worker container restarts. No S3 upload, no signed URLs, no download endpoint. Customers cannot access produced files. **This is the single biggest blocker.**

2. **PDF report generation.** Today's reports are markdown-only. The Full MVP requires a polished, downloadable PDF: cover page, transcript snippet, full analysis, charts where applicable. No HTML-to-PDF pipeline exists today.

3. **Artifact viewer UI.** Run Trace shows the IEE progress polling but has no artifact preview, download, or share affordances. Users cannot click through from Run Trace to the produced artifacts.

4. **Production hardening.** No retry policy under provider rate limits beyond the generic `withBackoff`. No observability for stuck runs (e.g., "browser worker has been on step 7 for 15 minutes"). No coverage of failure modes (login change, page structure change, transcription failure, S3 upload failure).

5. **Run-output presentation in Run Trace headline.** The foundation Run Trace UI shows duration and cost; for a Full MVP it should also show "Report ready" with a download link inline.

### 4.2 Target state

A Full MVP that:

1. Runs end-to-end on a scheduled cadence (existing `agent-scheduled-run` queue handles scheduling).
2. Produces a downloadable PDF report and a transcript artifact, both stored in S3 with signed URLs.
3. Surfaces "Report ready · Download" inline in the Run Trace headline.
4. Recovers gracefully from common failure modes: login change (HARD failure, Risk Tier alert), page-structure change (degraded run flagged), transcription failure (retry once, then degrade to "transcript unavailable; raw audio file delivered").
5. Logs through the foundation Run Trace virtual view; failures are diagnosable from the UI.
6. Idempotent across retries; produces the same content hash for the same source video.

### 4.3 Gap design — file delivery

Covered in Section 6 (shared infrastructure between both MVPs). The 42 Macro MVP is the first consumer.

### 4.4 Gap design — PDF report generation

#### 4.4.1 Library choice

**Recommended: `@react-pdf/renderer`** (server-side React-to-PDF). Trade-offs:

| Library | Pros | Cons |
|---|---|---|
| `@react-pdf/renderer` (recommended) | Pure JS, runs in Node, layout-rich, version-stable, no native deps | Slightly slower than native renderers |
| `puppeteer` | Browser-fidelity HTML to PDF | Requires headless Chromium in worker; we already have it but conflicts with IEE worker browser pool |
| `weasyprint` (Python) | High-quality print rendering | Adds Python dependency; deployment complexity |

`@react-pdf/renderer` is the cleanest fit. The worker already runs Node; no new runtime dependency. Layout is described in JSX with a constrained component set (Page, View, Text, Image). The output is deterministic and content-hashable.

**Open Decision:** see Section 11.1 if the architect wants to revisit.

#### 4.4.2 Report template

```
┌─ Cover ───────────────────────────────────────────┐
│  42 Macro Daily Report                             │
│  [Date]                                             │
│  [Source: macro.42 · video title · published date] │
└────────────────────────────────────────────────────┘
┌─ Executive Summary (1 page) ─────────────────────┐
│  3 to 5 bullet headline takeaways                  │
│  Generated by `analyse_42macro_transcript` skill   │
└────────────────────────────────────────────────────┘
┌─ Full Analysis (2 to 4 pages) ───────────────────┐
│  Sections defined by skill spec                    │
└────────────────────────────────────────────────────┘
┌─ Transcript Excerpt (if relevant) ───────────────┐
│  First N tokens; full transcript linked separately │
└────────────────────────────────────────────────────┘
```

The PDF has a fixed shape; it does not adapt per run. Future variations: add a "delta from yesterday" section once we have run-over-run comparison (Phase 2).

#### 4.4.3 Implementation

PDF rendering runs server-side in the main app (not the worker), keeping the worker's responsibilities narrow (browser automation + transcription) and letting `@react-pdf/renderer` reuse the main app's React + tooling. The worker hands off the transcript artifact and structured analysis to the main app via the existing run-completed event; the main app renders the PDF and uploads it via `fileDeliveryService` (Section 6.1.3). No PDF rendering happens in the worker.

**Determinism contract.** `@react-pdf/renderer` raw output is NOT byte-deterministic out of the box — embedded creation timestamps, object-ordering nondeterminism, and library-version metadata vary across runs. The acceptance criterion in §9.1 ("byte-deterministic across re-runs") is satisfied via a small post-render normalization step in `reportRenderingService`:

1. Pin `@react-pdf/renderer` to an exact version in `package.json` (no caret); record the version in the rendered PDF metadata (`Producer` field).
2. After render, normalise: zero out the `/CreationDate` and `/ModDate` PDF metadata fields, sort the object stream's xref table deterministically, strip the `/ID` array.
3. The hash recorded in `run_artifacts.content_hash` is the SHA-256 of the normalised bytes; the bytes uploaded to S3 are also the normalised bytes. Re-running the same input through the same library version against the same React component tree produces an identical hash.

If `@react-pdf/renderer` is later swapped (Open Decision 11.1), the determinism contract has to be re-validated against the new library; the contract itself does not change.

| File | Change | Rough LOC |
|---|---|---|
| `server/services/reportRenderingService.ts` | New service: `renderMacroReportPdf(input: MacroReportInput): Promise<Buffer>` | +200 |
| `server/services/reportTemplates/MacroReport.tsx` | React component for the PDF template | +180 |
| `server/services/__tests__/reportRenderingServicePure.test.ts` | Pure-function tests (golden PDF byte check, content-hash determinism) | +80 |
| `server/jobs/ieeRunCompletedHandler.ts` | After IEE-mode 42 Macro run completes, call `reportRenderingService.renderMacroReportPdf` and persist via file-delivery service. Existing handler — extended; not new. | +30 |

**Total: ~490 LOC.**

#### 4.4.4 PDF rendering — idempotency and retry semantics

The `ieeRunCompletedHandler` invokes `renderMacroReportPdf` followed by `fileDeliveryService.upload`; either step can fail. The MVP's posture:

- **Idempotency key.** The PDF row in `run_artifacts` is keyed on `(organisation_id, agent_run_id, artifact_kind, content_hash)` via the composite partial unique index `run_artifacts_run_kind_hash_unique` defined in §6.1.2. Re-rendering the same input produces the same content hash by design (PDF byte determinism per §4.4.1), so a retried render maps to the same row via that index. The storage key (per §6.1.1 storage layout: `orgs/{org_id}/runs/{run_id}/{artifact_kind}/{content_hash}.{ext}`) is unique by construction; the composite DB index is the logical idempotency boundary.
- **Retry classification.** `safe`. The handler can be invoked unconditionally for the same `agent_run_id`; a duplicate invocation finds the existing `run_artifacts` row, emits `phase1.file_delivery.uploaded` with `wasReplay: true`, and returns. No work is duplicated, no row is overwritten.
- **Failure path — render fails.** The handler bubbles the error to pg-boss, which retries up to 3 times with exponential backoff (existing pg-boss policy); on exhaustion the agent run completes with a `phase1.macro.report_rendering_failed` event and no `run_artifacts.report` row. The transcript artifact is still delivered (it does not depend on the report). The Run Trace headline shows "Transcript ready · Download · Report unavailable (rendering failed)".
- **Failure path — render succeeds, upload fails.** Same retry posture; the composite partial unique index `run_artifacts_run_kind_hash_unique` (§6.1.2) ensures we never get a duplicate row. On exhaustion, the run completes without the report row and emits `phase1.macro.artifact_upload_failed` per §4.6.1.
- **No partial state.** A successful render that fails to upload leaves NO row in `run_artifacts`; the handler does not insert the row until upload returns 200. The customer-facing UI never sees a "report exists but cannot be downloaded" state.

This treats PDF rendering identically to the §6.1.4 worker-side artifact upload: the backing store is the source of truth; the row is inserted only after the bytes land.

### 4.5 Gap design — artifact viewer UI

#### 4.5.1 Run Trace headline addition

The foundation Run Trace headline today reads: "Native run · auto-approved · 45 seconds · $0.08". For 42 Macro runs, append an artifact link inline:

```
Native run · auto-approved · 45 seconds · $0.08 · Report ready ↓ Download
```

The "Download" link triggers a signed-URL fetch from the file delivery service.

#### 4.5.2 Artifacts panel in Run Trace

Below the existing tool-call tree, add an "Artifacts" section that lists every artifact produced by the run:

```
Artifacts
─────────
  Report.pdf            42 KB   [Preview]  [Download]  [Copy link]
  Transcript.srt        18 KB   [Download]  [Copy link]
  source-video.mp4      32 MB   [Download]  [Copy link]   (auto-deleted in 7 days)
```

The "Preview" and "Download" buttons both fetch bytes through the main-app download proxy at `GET /api/run-artifacts/:id/download` (preserves attribution by emitting `phase1.file_delivery.downloaded` per §6.1.5b). The "Preview" button additionally streams the response into the existing `PDFEmbed` primitive (`consolidation-foundation`) for inline rendering.

The "Copy link" button calls `POST /api/run-artifacts/:id/signed-url` to mint a 7-day signed URL and writes it to the clipboard. This path emits `phase1.file_delivery.signed_url_issued` only — downloads initiated from the copied link bypass the proxy and DO NOT emit `phase1.file_delivery.downloaded`. This is the explicit attribution trade-off: a sharable URL cannot also be tracked. Operators who need download attribution use the Download button; Copy link is for sending the artifact to someone outside the app.

#### 4.5.3 Implementation

| File | Change | Rough LOC |
|---|---|---|
| `client/src/components/run-trace/RunTraceArtifactsPanel.tsx` | New component | +120 |
| `client/src/components/run-trace/RunTraceHeadline.tsx` | Add artifact-ready badge inline | +20 |
| `client/src/lib/api/runArtifacts.ts` | New API client wrapper (artifact list + signed-URL mint + proxy fetch) | +40 |
| `server/routes/agentRuns.ts` | New route `GET /api/agent-runs/:runId/artifacts` — wraps `withOrgTx(req.orgId!, ...)`; returns artifact metadata only (no embedded URLs); RLS on `run_artifacts` enforces tenant scope at the read | +40 |
| `server/routes/runArtifacts.ts` | New route file — `GET /api/run-artifacts/:id/download` (download proxy, emits `phase1.file_delivery.downloaded`) and `POST /api/run-artifacts/:id/signed-url` (signed-URL mint, emits `phase1.file_delivery.signed_url_issued`); both wrap `withOrgTx`, both call `agentRunVisibility.canView(req.user, artifact.agentRunId)` before returning bytes or a URL | +120 |
| `server/routes/__tests__/agentRunsArtifactsRoute.integration.test.ts` | Single integration test for the artifact list + download proxy + signed-URL mint | +90 |

**Total: ~430 LOC.** No frontend component tests per the project's testing posture.

**Permissions posture (artifact access).** No new permission tile is introduced for Phase 1. Artifact access follows the existing `agentRunVisibility` model (`server/lib/agentRunVisibility.ts`): a user who can view a run's metadata can list and download its artifacts. The route handlers above call `agentRunVisibility.canView(...)` before returning bytes or signed URLs; RLS on `run_artifacts` is the second layer. Adding a granular `files.download` permission is deferred to Phase 2 if customer feedback warrants finer control.

### 4.6 Production hardening

#### 4.6.1 Retry and degradation policy

| Failure mode | Detection | Action |
|---|---|---|
| Login change (selector miss, post-login probe fails) | `performLoginWithRetry` exhausted | Run terminates with `failureReason: 'login_failed'`; `phase1.macro.login_failed` log; admin notified via existing alert path |
| Page structure change (extract returns no candidates) | Skill returns "no video found" | Run terminates with `failureReason: 'page_structure_change'`; admin notified |
| Transcription failure | Whisper API retry exhausted | Run continues with `transcript: null`; report says "Transcription unavailable; raw audio file is attached" |
| S3 upload failure | `withBackoff` retry exhausted on the upload call | Run terminates with `failureReason: 'artifact_upload_failed'`; admin notified via existing alert path. No partial `run_artifacts` row is persisted. The transcript and PDF can be regenerated by re-running the macro task; this is preferable to a half-state with a "Retry upload" affordance the schema does not currently support. |
| Provider rate limit | Existing `withBackoff` with capped retry window | Run pauses up to N minutes; surfaces as "rate-limited" in Run Trace |

#### 4.6.2 Observability for stuck runs

A new `phase1.macro.run_stuck` log code fires when a 42 Macro run has been on the same step for longer than `MACRO_STUCK_THRESHOLD_MS` (default 15 minutes). The existing system-monitoring detector (`server/services/systemMonitoring/detectors/`) gains a `staleMacroRun` detector. Phase 1 surfaces the alert in the Activity feed; Phase 1.5 may add an automated recovery action.

#### 4.6.3 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `worker/src/browser/macroExecutor.ts` (or equivalent existing file) | Add explicit failure-mode branches per the table above | +60 |
| `server/services/systemMonitoring/detectors/staleMacroRunDetector.ts` | New detector | +80 |
| `server/services/systemMonitoring/detectors/__tests__/staleMacroRunDetectorPure.test.ts` | Pure-function tests for stuck-step threshold logic | +80 |
| `client/src/components/run-trace/MacroFailureRenderers.tsx` | New event renderers for `phase1.macro.report_rendering_failed` and `phase1.macro.artifact_upload_failed` (per §5.6.3 / §3.5 registry) | +60 |

**Total: ~280 LOC.**

### 4.7 Effort estimate for 42 Macro Full MVP

- PDF report generation: 6 to 10 dev-days
- Artifact viewer UI: 4 to 6 dev-days
- Production hardening: 5 to 8 dev-days

**Total: 15 to 24 dev-days (3 to 5 weeks).** Excludes shared file delivery infrastructure (Section 6.1.7, 8 to 12 dev-days), which is counted once and consumed by both MVPs.

---

## 5. Support Inbox Showcase MVP

### 5.1 Dependencies and current state

The Support Inbox MVP is the **agent layer** that runs on top of the Support Desk Canonical layer (PR #277, merged 2026-05-10). The canonical layer provides the data substrate (tickets, messages, drafts, inboxes, support agents) and the dispatch primitives (three-phase dispatch, reconciliation, idempotency); the agent layer in this spec is the SynthetOS agent that consumes them.

#### 5.1.1 What's in place from the canonical layer

| Component | Location | What it does |
|---|---|---|
| Canonical schema | `server/db/schema/canonicalTickets.ts`, `canonicalTicketMessages.ts`, `canonicalTicketDrafts.ts`, `canonicalInboxes.ts`, `canonicalSupportAgents.ts` | Provider-neutral data model for tickets, threads, drafts, inboxes, support agents |
| Migrations 0307-0312 | `migrations/0307_canonical_inboxes.sql` through `migrations/0312_action_attempts.sql` | Database schema |
| `supportTicketService` | `server/services/supportTicketService.ts` (+ pure helper) | Read/write canonical tickets within tenant scope |
| `supportInboxService` | `server/services/supportInboxService.ts` | Inbox-level configuration and policy |
| `supportDraftDispatchService` | `server/services/supportDraftDispatchService.ts` (748 lines) | Three-phase dispatch: preflight → durable transition → adapter call |
| `draftCandidatesService` | `server/services/draftCandidatesService.ts` | Candidate-draft generation surface |
| `ruleCandidateDrafter` | `server/services/ruleCandidateDrafter.ts` | Deterministic rule-based candidate drafting |
| 10 `support.*` skill specs | `server/skills/support/{add-internal-note,approve-draft,assign,find-customer-history,list-open-tickets,propose-reply,read-thread,reject-draft,set-status,tag}.md` | Markdown skill prompts wired through `skillExecutor` |
| Support routes | `server/routes/support/{supportTicketsRoutes,supportDraftsRoutes,supportInboxesRoutes}.ts` | REST surface for tickets / drafts / inboxes |
| 8 support UI components | `client/src/components/support/{BackLinkAwaitingBadge,CollisionCallout,DraftOverlayMessage,PriorityPill,QuarantineBanner,StatusPill,SyncHealthPill,ThreadMessage}.tsx` | Reusable UI primitives |
| Reconciliation worker | `server/jobs/supportDraftReconciliationWorker.ts` | Background reconciliation of dispatched drafts |
| Boot recovery | `server/jobs/supportDispatchBootRecovery.ts` | Recovery on worker restart |
| Teamwork adapter extensions | `server/services/connectorPollingService.ts` (+716 lines), `server/services/webhookAdapterService.ts` (+535 lines) | Teamwork ingestion + webhook normalisation |

#### 5.1.2 What's missing for the showcase MVP

The canonical layer is data + plumbing. **The agent itself does not exist yet.** The showcase MVP ships:

1. **The Support Agent definition** — a row in `system_agents` (or `subaccount_agents`) that ties together the prompt, tool selection, scheduling, model routing, and policy.
2. **Agent prompt + tool selection** — system prompt that orchestrates the 10 `support.*` skills into a coherent triage-draft-approve loop.
3. **Autonomous vs assisted mode policy** — per-inbox configuration that decides whether the agent auto-approves drafts (autonomous mode) or always requires human approval (assisted mode). The canonical layer's `canonical_inboxes.agent_config` JSONB carries this; the agent reads it.
4. **Collision avoidance policy** — the agent reads `canonical_tickets.last_human_activity_at` and `bot_claimed_at` and refuses to act when humans are active. The canonical primitives are in place; the policy that uses them lives in this agent's spec.
5. **Eval / quality harness** — regression set of historical tickets, accuracy thresholds for classify and draft, drift detection.
6. **Customer-facing tone calibration per inbox** — the agent reads inbox-level prompt overrides for voice/tone consistency.
7. **Inbox monitoring trigger** — the agent runs on a schedule plus on webhook (new inbound ticket fires the agent).

### 5.2 Target state

A Support Agent that:

1. Wakes on schedule (every N minutes per inbox, configurable) and on webhook (Teamwork ticket.created event).
2. Reads new tickets from `canonical_tickets` via `supportTicketService.listOpenTickets`.
3. Classifies each ticket using a `support.classify_ticket` skill (NEW — see Section 5.4) into intent + urgency + recommended-action.
4. For tickets where a draft is appropriate: generates a draft reply via the existing `support.propose_reply` skill (which writes a `canonical_ticket_drafts` row through `draftCandidatesService`).
5. For tickets where the draft can be auto-approved (per inbox policy): triggers the existing `support.approve_draft` skill which kicks off the three-phase dispatch.
6. For tickets requiring human review: routes to the existing review queue + Slack Block Kit approval flow (no new code; existing HITL path).
7. For tickets the agent cannot handle (ambiguous, escalation needed): adds an internal note via `support.add_internal_note` and assigns to a human via `support.assign`.
8. Surfaces every decision in Run Trace via the foundation virtual view.
9. Respects collision avoidance: if a human has touched the ticket within `min_minutes_since_human_activity` (per inbox config), the agent does not act.
10. Honours autonomous vs assisted mode per inbox without code change (configuration only).

### 5.3 Agent design

#### 5.3.1 Agent record

A new row in `system_agents` (column names per `server/db/schema/systemAgents.ts`):

| Column | Value |
|---|---|
| `slug` | `support-agent` |
| `name` | `"Support Agent"` |
| `master_prompt` | locked, system-managed (Section 5.3.2 below) |
| `default_system_skill_slugs` | `['support.list_open_tickets', 'support.read_thread', 'support.classify_ticket', 'support.propose_reply', 'support.add_internal_note', 'support.assign', 'support.set_status', 'support.tag', 'support.approve_draft', 'support.reject_draft', 'support.find_customer_history', 'ask_clarifying_question']` (12 skills: 11 `support.*` + 1 universal `ask_clarifying_question`; no `web_search` per NG3) |
| `default_org_skill_slugs` | empty (org admins do not extend support skills) |
| `execution_mode` | `'api'` (Native style; existing column) |
| `execution_scope` | `'subaccount'` (existing column) |
| `model_provider` / `model_id` | `'anthropic'` / `'claude-sonnet-4-6'` (existing columns) |
| `is_published` | `true` |
| `status` | `'active'` |

**Native Controller as default.** `system_agents` does not have a `default_controller_style` column today. The Support Agent's "Native by default" posture is enforced at runtime: when a Support Agent run is created, `agent_runs.controller_style` (added in the foundation refactor, migration 0308) is set to `'native'` by the agent-execution path. If we later need to make this a configurable default per system agent, add a `default_controller_style text` column on `system_agents` in a follow-up migration. Out of scope for this MVP.

**Singleton-per-subaccount.** `system_agents` does not have an `is_singleton` column. "One Support Agent per subaccount" is enforced at install time by the install-flow code path: when installing the system Support Agent into a subaccount, the install service checks for an existing active subaccount-level installation that references this `system_agent_id` (via the `applied_template_id` linkage on `subaccount_agents`) and refuses if one already exists. No new schema change required for the MVP.

**Concurrency under racing installs.** Two concurrent install attempts for the same subaccount could both pass the existence check before either commits. The MVP defends against this with two layers:

1. **PG advisory transaction lock keyed on `(subaccount_id, system_agent_id)`** taken at the start of the install transaction (`pg_advisory_xact_lock(hashtextextended(...))`). The second concurrent transaction blocks until the first commits or rolls back; on resume it re-runs the existence check and refuses with a 409.
2. **Partial unique index on `subaccount_agents`** scoped to the Support Agent template by stable slug. The schema does not currently carry a slug on `subaccount_agents` (only `applied_template_id`), and a partial index cannot reference another table — so the install migration ships an additive `applied_template_slug text` column (INV-5-allowed: additive only) populated from `system_agents.slug` at install time, plus the index. Existing rows are backfilled in the same migration via a join. Both DDL statements live in the migration that adds the install-flow code:

```sql
-- 1. Additive column (INV-5: no behaviour change for existing callers).
ALTER TABLE subaccount_agents ADD COLUMN applied_template_slug text;

-- 2. Backfill from system_agents.slug for existing rows where the linkage exists.
UPDATE subaccount_agents sa
SET    applied_template_slug = a.slug
FROM   agents a, system_agents sysa
WHERE  sa.applied_template_id = sysa.id
  AND  a.id = sa.agent_id
  AND  a.system_agent_id = sysa.id
  AND  sa.applied_template_slug IS NULL;

-- 3. Partial unique index, scoped to the Support Agent template by slug.
CREATE UNIQUE INDEX subaccount_agents_support_agent_singleton_idx
ON subaccount_agents (subaccount_id)
WHERE is_active = true
  AND applied_template_slug = 'support-agent';
```

Even if both transactions somehow proceeded past the advisory lock, the index rejects the second insert with `23505`; the install service maps this to a 409 with body `{ error: 'already_installed' }`. The existing `subaccount_agents_unique_idx` covers `(subaccount_id, agent_id)` but not the system-agent-template scope; this MVP adds the slug column + the partial index in the same migration that adds the install-flow code. The install service writes `applied_template_slug` on every new install (set from `system_agents.slug` after the existence check, before the INSERT), and the slug column has no other consumers in Phase 1.

The advisory lock is the primary defence (clean error path); the partial index is the safety net (serialisation guarantee). Acceptance criterion in §9.2 covers the race outcome (one success + one 409 under concurrent install).

**File inventory addition (Support Agent install flow):**

| File | Change | Rough LOC |
|---|---|---|
| `migrations/<next-available>_support_agent_install.sql` + `.down.sql` | Additive `subaccount_agents.applied_template_slug` column + backfill UPDATE + partial unique singleton index. Migration number assigned at chunk-build time. | +50 |
| `server/db/schema/subaccountAgents.ts` | Drizzle schema: add `appliedTemplateSlug: text('applied_template_slug')` (nullable) | +3 |
| `server/services/supportAgentInstallService.ts` | New install service: advisory-lock + existence-check + INSERT with `applied_template_slug='support-agent'`; maps `23505` to `409 already_installed` | +120 |
| `server/services/__tests__/supportAgentInstall.integration.test.ts` | Single integration test for the concurrent-install acceptance criterion (§9.2) | +90 |
| `server/routes/support/supportAgentInstallRoute.ts` | POST `/api/subaccounts/:subaccountId/support-agent/install` route handler; calls `resolveSubaccount` then delegates to the install service | +40 |

**Subtotal: +303 LOC for the install flow.** Counted alongside §5.6.4's UI surfaces.

The agent is system-managed: customers cannot edit the master prompt; they can only configure per-inbox `agent_config` (mode, collision window, draft expiry, prompt overrides).

#### 5.3.2 Master prompt structure

The master prompt is markdown, living at `server/prompts/support-agent-master.md`. Loaded at agent run start by `agentExecutionService` via the existing prompt-loading path. Structure:

```markdown
# Support Agent Master Prompt

You are the Support Agent for {{org_name}} — {{subaccount_name}}.

## Your job
Triage incoming support tickets, draft replies, escalate when appropriate,
and never act on tickets where humans are active.

## Your tools
- support.list_open_tickets
- support.read_thread
- support.classify_ticket    (use first on every ticket)
- support.propose_reply      (writes draft; does not send)
- support.add_internal_note  (visible to team; not customer)
- support.assign             (route to a human support agent)
- support.set_status / support.tag
- support.approve_draft / support.reject_draft  (only after human review unless inbox is autonomous)
- support.find_customer_history  (cross-reference CRM)
- ask_clarifying_question     (universal skill; only when context is genuinely missing — not a default move)

## Rules
1. Always classify before drafting.
2. If `last_human_activity_at` is within {{collision_window_minutes}} minutes, DO NOT act. (Sourced from `agent_config.collisionWindow.minMinutesSinceHumanActivity`.)
3. Customer-facing replies (visibility=public) are always Tier 6; approval policy comes from inbox `agent_config.mode`.
4. Internal notes (visibility=internal) are Tier 2; auto-approve.
5. Status changes and tags are Tier 2; auto-approve.
6. Reassignment to a human is Tier 1; auto-approve.
7. Use customer history (find_customer_history) for any classified-as-account-issue ticket.
8. Escalate to a human (assign + add_internal_note) when:
   - Classification confidence below {{min_confidence}}
   - Ticket category in {{escalate_categories}}
   - Customer is high-priority (find_customer_history reports flag)

## Output style
- Replies match {{voice_profile}} (sentence length, tone, sign-off)
- Internal notes are terse and factual
- Always cite the source thread message id when referencing a customer's words
```

The `{{ ... }}` placeholders are filled at run start from `canonical_inboxes.agent_config`. The shape that exists today (per `shared/types/supportInboxAgentConfig.ts`) is:

```ts
{ version: 1,
  mode: 'autonomous' | 'assisted' | 'disabled',
  collisionWindow: { minMinutesSinceHumanActivity: number, respectHumanAssignee: boolean },
  draftExpiry: { awaitingReviewHours: number, draftHours: number },
  modelOverride?: string,
  promptOverride?: string,
  optIns: { autonomousReplyOnWaitingOnCustomer: boolean, postResolutionFollowUp: boolean } }
```

This MVP needs three additive fields on the schema: `minConfidence: number` (default 0.8), `voiceProfile: 'casual' | 'neutral' | 'formal' | 'custom'` (default `'neutral'`), `escalationCategories: string[]` (default `[]`). The Zod schema in `shared/types/supportInboxAgentConfig.ts` is updated additively (all three optional with documented defaults); no migration is required because `agent_config` is a JSONB column with a `.default` already applied. **File inventory addition (§5.6.4):** `shared/types/supportInboxAgentConfig.ts` — add three optional fields with defaults, +15 LOC.

**Default mode for a newly-installed Support Agent.** The existing `canonical_inboxes.agent_config.mode` defaults to `'disabled'` for a brand-new inbox. When a Support Agent is wired to a subaccount and an inbox is enabled for the agent, the install / enablement code path bumps the mode to `'assisted'` (HITL approval required for every customer-facing reply). The operator may then flip a single inbox to `'autonomous'` from the Inbox Agent Configuration tab (§5.6.2).

#### 5.3.3 Execution flow per ticket

1. Agent run starts; loads inbox config, policy envelope, master prompt with placeholders filled.
2. `support.list_open_tickets(inbox_id)` returns N tickets needing attention.
3. For each ticket, in order:
   - **Atomic claim** (§5.3.4): acquire `canonical_tickets.bot_claimed_at` via optimistic predicate; on conflict, emit `phase1.support.collision_skipped` (reason `concurrent_claim`) and skip.
   - **Human-activity collision check** (immediately after claim, BEFORE thread read or classification): if `last_human_activity_at` is fresh (within inbox `agent_config.collisionWindow.minMinutesSinceHumanActivity`), the agent releases the claim, emits `phase1.support.collision_skipped` (reason `human_active`), and skips. Classification is agent work and must not run while a human is active. The check is a single SQL fetch on the same row the claim acquired, so it costs nothing relative to the LLM call it gates.
   - `support.read_thread(ticket_id)` loads the conversation history.
   - `support.classify_ticket(ticket_id)` returns `{intent, urgency, recommended_action, confidence}`.
   - **Confidence check**: if confidence below `min_confidence`, the agent calls `support.add_internal_note` with classification reasoning + `support.assign(human)` and skips drafting.
   - **Account-issue check**: if classified as account/billing/escalation, call `support.find_customer_history` and incorporate into draft.
   - **Drafting**: call `support.propose_reply` to write a `canonical_ticket_drafts` row.
   - **Approval routing**: per inbox `agent_config.mode`:
     - `autonomous`: call `support.approve_draft` → three-phase dispatch fires automatically.
     - `assisted`: leave the draft in `awaiting_review` state; the existing review queue + Slack Block Kit flow takes over.
4. Agent run terminates; Run Trace shows the per-ticket decision tree.

#### 5.3.4 Per-ticket concurrency guard (atomic claim)

The agent wakes on schedule and on webhook (Teamwork ticket.created), so two concurrent runs CAN target the same ticket. The canonical layer already provides the primitives (`canonical_tickets.bot_claimed_at`, `canonical_tickets.bot_claimed_by_run_id`); this MVP wires them as the per-ticket concurrency guard.

**Idempotency posture:** state-based, optimistic predicate.

**Claim acquisition.** Before the agent reads the thread or classifies a ticket, it issues an optimistic claim:

```sql
UPDATE canonical_tickets
SET    bot_claimed_at = now(),
       bot_claimed_by_run_id = :runId
WHERE  id = :ticketId
  AND  organisation_id = :orgId
  AND  (bot_claimed_at IS NULL
        OR bot_claimed_at < now() - interval ':claimTtlMinutes minutes')
```

0 rows affected = another run is processing this ticket; the agent emits `phase1.support.collision_skipped` (with reason `concurrent_claim`) and moves on. 1 row affected = this run owns the ticket for the next `claimTtlMinutes`.

**Claim TTL.** Default 15 minutes. Long enough that a single ticket's classify-draft cycle never bumps against it, short enough that a crashed run does not block subsequent runs for long.

**Clock-skew safety.** The `now()` and `bot_claimed_at` comparison runs server-side in PostgreSQL on a single row, not across distributed worker clocks. The agent worker never compares its local clock to the database; the optimistic predicate is evaluated entirely inside the database with `now()` resolving to the database's transaction clock. Even if the worker's wall clock is wrong, the claim is correct. The 15-minute TTL is large enough that NTP drift between database replicas (under the 100ms Postgres replication budget on this infra) is irrelevant to the claim's correctness boundary.

**Claim release.** On terminal verdict (draft_proposed, escalated, or skipped) the agent clears the claim by setting `bot_claimed_at = NULL`. On run abort, the claim ages out via the TTL — no recovery worker is required for Phase 1.

**Per-ticket terminal verdicts.** Each ticket within a single agent run reaches exactly one terminal verdict from the set: `drafted_for_review` | `drafted_and_dispatched` | `escalated_to_human` | `skipped_collision` | `skipped_low_confidence` | `skipped_no_action_needed`. Exactly one terminal Run Trace event fires per ticket per agent run (per checklist §10.4): the draft branches emit `phase1.support.draft_proposed` (with `perTicketVerdict` ∈ {`drafted_for_review`, `drafted_and_dispatched`}); the collision branch emits `phase1.support.collision_skipped` (with `perTicketVerdict: 'skipped_collision'`); the remaining three branches (`escalated_to_human`, `skipped_low_confidence`, `skipped_no_action_needed`) emit `phase1.support.ticket_terminal` with the `perTicketVerdict` payload field. No further events fire for that ticket+run after the terminal.

**Run-loop (cross-ticket) idempotency.** A single Support Agent run iterates over N tickets; partial completion (worker crash, deploy restart, pg-boss retry) is possible. The MVP's posture is per-ticket retryable, not run-level transactional:

- **No outer-loop idempotency key.** A retried agent run does NOT attempt to "resume" the prior run. It enqueues a fresh run and lets the per-ticket atomic claim (above) absorb the duplication: any ticket the prior run already terminated will either still hold a non-stale claim (the new run skips with `concurrent_claim`) or have already received its terminal Run Trace event since the latest customer activity (the new run sees no eligible tickets in `support.list_open_tickets` because the terminal-event predicate below filters it out).
- **`support.list_open_tickets` is the idempotency boundary.** The query that selects tickets for processing filters out tickets that already have a terminal `phase1.support.*` event recorded SINCE the ticket's last customer message. No new persistence is needed beyond what's already written by the per-ticket terminal events. The exact predicate against the canonical event store:

```sql
WHERE NOT EXISTS (
  SELECT 1
  FROM   agent_execution_events e
  WHERE  e.organisation_id = canonical_tickets.organisation_id
    AND  e.payload->>'ticketId' = canonical_tickets.id::text
    AND  e.event_type IN (
           'phase1.support.draft_proposed',
           'phase1.support.collision_skipped',
           'phase1.support.ticket_terminal'
         )
    AND  e.created_at >= canonical_tickets.last_customer_message_at
)
```

The `>= last_customer_message_at` anchor is the key: a ticket that received a new customer reply AFTER its prior terminal event becomes eligible again on the next run, because the predicate finds no qualifying terminal event in the new window. Without this anchor, a one-time terminal event would silently exclude the ticket forever even after the customer responds. The three terminal event types match the per-ticket terminal-verdict set documented above (`drafted_for_review` / `drafted_and_dispatched` and the three non-draft, non-collision branches all emit one of those three event names). Test fixture in `supportListOpenTicketsPure.test.ts` exercises the re-eligibility case (terminal event → new customer message → ticket re-appears).
- **pg-boss retry policy on the agent-run handler is `singleton: true` per (subaccount_id, inbox_id)`.** The handler claims a per-(subaccount, inbox) advisory lock at run start; a duplicate run for the same inbox enqueued by both schedule and webhook simply waits for the lock and then sees no eligible tickets. The lock is released on run termination (success or fail).
- **What this does NOT cover.** Cross-inbox parallel runs for the same subaccount ARE allowed (different inboxes, different lock keys). That is by design — inbox A's processing must not block on inbox B's queue depth. Cross-subaccount parallelism is naturally bounded by RLS scope.

The result: the agent run itself does not need to be idempotent; the per-ticket claim plus the `list_open_tickets` filter make duplicate runs safe by elimination, not by transaction.

#### 5.3.5 Master prompt lifecycle (versioning, update, rollback)

The `system_agents.master_prompt` value is system-managed (not editable by org admins). Updates to it follow a constrained lifecycle so customer voice and compliance posture cannot drift silently:

- **Version pinned to `system_agents.version`.** Each non-trivial change to the master prompt bumps `system_agents.version` (existing column). Subaccount installations record the `applied_template_version` they were installed against (existing column on `subaccount_agents`); upgrades to a new master-prompt version are explicit, not implicit.
- **Update path.** Master prompt edits land via standard PR review (architect + pr-reviewer + chatgpt-pr-review for any user-facing wording change). The prompt is treated as a frontmatter-style markdown file under `server/prompts/support-agent-master.md` with a header `version: N` line; the migration that bumps `system_agents.version` lives in the same PR.
- **Eval gate before bump.** A prompt-version bump runs the eval harness (§5.5) on the regression set in CI; if classification accuracy or draft-quality scores drop below the prior version's results by more than the drift threshold (§5.5.2), the bump is blocked. This prevents an "improvement" from regressing customer-visible output.
- **Rollback.** Each version is keyed in `system_agents` history; rollback is a `system_agents.version = N-1` revert via migration, plus the corresponding `master_prompt` revert. Subaccounts on the new version are auto-rolled-back to N-1; the eval harness re-runs to confirm.
- **Per-inbox `promptOverride` does not stack with master-prompt versions.** The override is a small voice-tone string (max 500 chars, see §5.3.7), composed onto whatever master-prompt version the inbox's `subaccount_agent.applied_template_version` resolves to. Operators do not see the master-prompt body; the override is purely additive.

**Out of scope for the MVP:** customer-visible prompt-change notifications (Phase 2), per-org branching of the master prompt (Phase 3 multi-tenant tone control).

#### 5.3.6 Per-inbox promptOverride safety (input handling for freeform voice profile)

`canonical_inboxes.agent_config.promptOverride` is a freeform textarea exposed to org admins (per §5.6.2). Without controls, this is a prompt-injection surface: a malicious or careless override could make the Support Agent leak internal context, invoke skills outside its allowed set, or impersonate a different role. The MVP applies four narrow controls:

1. **Length cap** — server-side validation rejects overrides longer than 500 characters. Voice-tone calibration does not need long blocks; long overrides are almost always misuse.
2. **Allowed-section composition** — the override is injected as a labelled section (`### Inbox voice override (non-authoritative)`) AFTER the master prompt's ### Rules section, never inline. The master prompt explicitly instructs the model to disregard any instruction in the override section that would change tool use, redirect output to a different recipient, or bypass approval policies. The exact wording is part of the master prompt, not the override.
3. **Forbidden-token scan** — server-side `validatePromptOverride()` (a pure helper) rejects overrides containing common injection markers: `</?system>`, `</?user>`, `<<SYS>>`, `### Rules`, `BEGIN SYSTEM`, `ignore previous`, `disregard`, raw role-switching tokens, or runs of three or more backticks. Failure surfaces inline on the config form. List is conservative; expand based on attempted overrides observed in production.
4. **Audit trail** — every change to `agent_config.promptOverride` is logged to the existing audit-event stream with the diff of the prior and new value, the actor's user id, and the inbox id. No silent edits.

These controls are dev-discipline, not a security boundary. The defence in depth is that the agent's tool surface is fixed (the 12-skill list in §5.3.1: 11 `support.*` skills + the universal `ask_clarifying_question`; no `web_search` or `search_knowledge_base` per NG3) and customer-facing replies still go through three-phase dispatch with HITL approval in `assisted` mode. A successful prompt injection still cannot send a reply without passing those gates.

**File inventory addition (§5.4.3 / §5.6.4):** `server/services/promptOverridePure.ts` (validator) — +60 LOC; route-handler integration in `supportInboxesRoutes.ts` — +20 LOC; tests for forbidden-token scan + length cap — +60 LOC.

#### 5.3.7 Why this is Native Controller, not Operator

Per v1.2 brief Section 5.2, Native is "deterministic, structured, short-lived". The Support Agent loop above is structured (always classify → draft → route) and short-lived (one pass through N tickets). It is NOT an autonomous reasoning loop that explores ambiguity or persists across hours. It is a triage pipeline.

The "light Operator escalation" referenced in the v1.2 brief is achieved by **flagging ambiguous tickets for human investigation**, not by spinning up a long-running Operator loop. Full Operator Controller for support investigation is a Phase 3 capability per the brief.

This means: `agent_runs.controller_style = 'native'` for every Support Agent run. Operator runs come later when complex investigation is required.

### 5.4 Skills and execution flow

#### 5.4.1 New skill: `support.classify_ticket`

The 10 `support.*` skill specs from PR #277 do not include a classify skill. The Support Agent needs one to drive triage; this spec adds it.

**Skill location:** `server/skills/support/classify-ticket.md`

**Skill shape:**

```yaml
slug: support.classify_ticket
risk_tier: 1                    # internal data read; no external write
gate_level: auto                # derived from tier
read_path: canonical            # reads canonical_tickets + canonical_ticket_messages
idempotency: read_only

input_schema:
  ticket_id: string (uuid)

output_schema:
  intent: enum
    - account_question
    - billing_question
    - bug_report
    - feature_request
    - how_to_question
    - complaint
    - cancellation_request
    - sales_inquiry
    - other
  urgency: enum
    - low | medium | high | urgent
  recommended_action: enum
    - draft_reply
    - escalate_to_human
    - add_internal_note_only
    - close_as_no_action
  confidence: number (0..1)
  reasoning: string
  escalate_reason: string | null
```

The skill uses platform Anthropic (Claude Sonnet 4.x) via the LLM router. Prompt template lives alongside the markdown file.

**Runtime contract enforcement.** The output is parsed through a Zod schema (`shared/types/supportClassifyTicketResult.ts`, +35 LOC) before the agent acts on it. The schema mirrors the YAML shape above with strict enums, `confidence: z.number().min(0).max(1)`, and `escalate_reason: z.string().nullable()`. Parse failure (model returns null for a required field, returns a value outside the enum, returns a non-numeric confidence) maps to: emit `phase1.support.classify_failed` with the raw model output stored under a redacted-PII payload field, treat the ticket as low-confidence, route to `add_internal_note + assign(human)`. The skill never proceeds to drafting on a malformed classification. Tested in `supportClassifyTicketPure.test.ts` with three malformed-output fixtures (null intent, out-of-range confidence, missing recommended_action).

**Caching:** classification results are cached by content hash of `(ticket_id, last_message_external_id)` in a new lightweight cache table or in `agent_run_messages` reuse. See Open Decision 11.4.

#### 5.4.2 Existing skill consumption pattern

The Support Agent calls the existing 10 `support.*` skills through the standard `skillExecutor` dispatch path. No new dispatch logic. The existing three-phase dispatch (`supportDraftDispatchService`) handles approval-to-send transitions.

Per `INV-9`, every `support.*` action carries a Risk Tier; the foundation refactor's CI gate enforces it. Tier assignments for the 10 existing skills:

| Skill | Risk Tier | Default gateLevel |
|---|---|---|
| `support.list_open_tickets` | 1 | auto |
| `support.read_thread` | 1 | auto |
| `support.classify_ticket` (new) | 1 | auto |
| `support.find_customer_history` | 1 | auto |
| `support.add_internal_note` | 2 | auto |
| `support.set_status` | 2 | auto |
| `support.tag` | 2 | auto |
| `support.assign` | 1 | auto |
| `support.propose_reply` | 2 | auto (writes a draft, not a customer-facing message) |
| `support.approve_draft` (agent-callable, in autonomous mode only) | 6 | block unless inbox `mode=autonomous` policy override |
| `support.reject_draft` | 1 | auto |
| `ask_clarifying_question` (universal) | 0 | auto (existing entry, listed for completeness) |

**Two distinct approval paths.** Risk Tier 6 on `support.approve_draft` gates the **agent-called auto-approval path** only:

- In `assisted` mode the agent's call to `support.approve_draft` is blocked; the draft sits in `awaiting_review` and the existing review queue + Slack Block Kit flow takes over. The human's approval is recorded through the existing review-queue / `reviewItems` / `reviewAuditRecords` path — NOT through `support.approve_draft`. The three-phase dispatch in `supportDraftDispatchService` consumes the human approval signal directly per the support-desk-canonical contract.
- In `autonomous` mode the per-inbox `agent_config.mode = 'autonomous'` policy override lowers the gate to `auto`, allowing the agent's call to `support.approve_draft` to proceed and trigger dispatch without human intervention.

In both modes the dispatch pathway is the same (`supportDraftDispatchService.dispatchDraft` → three-phase dispatch); only the trigger differs.

#### 5.4.3 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `server/skills/support/classify-ticket.md` | New skill spec | +110 |
| `server/services/skillHandlers/supportClassifyTicket.ts` | LLM-backed classify implementation | +180 |
| `server/services/skillHandlers/supportClassifyTicketPure.ts` | Pure helpers (intent enum, scoring, prompt construction) | +90 |
| `server/services/__tests__/supportClassifyTicketPure.test.ts` | Pure-function tests with fixture tickets | +120 |
| `server/config/actionRegistry.ts` | Register the new skill with `riskTier: 1` | +15 |
| `server/db/schema/systemSkills.ts` | Register the new `support.classify_ticket` skill row | +5 |
| Cache table + service | See Open Decision 11.4; LOC pending decision | (gated) |

**Total: ~520 LOC for the new skill (excluding cache, gated on Open Decision 11.4).**

#### 5.4.4 Existing skill prompt templates

The 10 `support.*` skill specs from PR #277 are markdown but each one needs a polished LLM prompt template that the agent loop assembles. The PR #277 build delivered the markdown specs and the dispatch wiring; **the prompt templates for the LLM-backed skills (`propose_reply`, `add_internal_note`, `find_customer_history` insights) are stubs and need refinement** per the support-desk-canonical handoff (Open Question OQ-3 — confirm with build status).

This spec ships:

| Skill | Template work |
|---|---|
| `support.propose_reply` | Polished prompt with `{{voice_profile}}` injection, customer-history context, intent-specific drafting rules, confidence scoring |
| `support.find_customer_history` | Polished prompt for cross-CRM lookup with deterministic search + LLM summary |
| `support.classify_ticket` | New (Section 5.4.1) |

Other skills (`list_open_tickets`, `read_thread`, etc.) are deterministic queries; no LLM template needed.

### 5.5 Eval and quality harness

#### 5.5.1 Why this is required for the MVP

A support agent that drafts customer-facing replies cannot ship without an eval harness. Wrong tone, hallucinated commitments, or misclassification all damage customer trust. Per INV-15, eval harness is part of acceptance.

#### 5.5.2 Eval components

| Component | Purpose |
|---|---|
| Regression set | 50 to 200 historical tickets with golden classifications + golden draft replies (provided by Foundry export, per support-desk-canonical OQ-1) |
| Classification accuracy | Per-intent precision + recall against the golden set; **initial threshold: >= 85% per intent** in v1, tunable during pilot before lock-in |
| Draft quality | LLM-as-judge scoring against rubric (helpfulness, tone match, factual accuracy); **initial threshold: >= 4.0 / 5.0 average**, tunable during pilot before lock-in |
| Drift detection | Daily run of regression set against current model + prompt; alert if scores drop > 10% week over week (drift threshold tunable post-pilot once a baseline is established) |
| Failure-mode coverage | Tickets that should escalate (confidence below threshold) are escalated; tickets where the agent should NOT act (collision window) are skipped |

**Prompt + model version pinning per eval run.** Every row in `support_eval_runs` records the exact `system_agents.version` (master prompt version) AND the model id (e.g., `claude-sonnet-4-6`) AND the skill prompt template hash for `propose_reply`, `classify_ticket`, `find_customer_history`. Comparison across runs is only meaningful when these three identity fields match. The drift detector splits its time-series view per `(prompt_version, model_id, skill_template_hashes)` triple — drift across versions is INFORMATIONAL (a prompt bump is expected to move scores), drift WITHIN a version against the same regression set is the alerting condition. The CI gate on prompt-version bumps (§5.3.5) consumes this same comparison.

**Regression-set availability fallback.** The acceptance gate depends on the Foundry-derived regression set being present (per support-desk-canonical OQ-1). If the export is unavailable, stale, or empty at gate time, the MVP's posture is fail-open with explicit operator visibility, NOT fail-closed:

- **Sub-2-row state.** Per §7.3 the `verify-support-agent-eval-thresholds.sh` gate exits 0 (fail-open) when the regression set has fewer than two rows, AND emits `phase1.support.eval_drift_detected` with payload `{ reason: 'regression_set_unavailable', rowCount: <N> }` so the operator sees the silence in the Activity feed. This prevents a one-off Foundry-export hiccup from blocking unrelated PRs.
- **Stale-data state.** A regression set older than 90 days (per `created_at` of the latest export row) emits an Activity-feed warning at every CI run but does not block. The acceptance gate at lock-in time (per §8.5 production verification step 5) requires a fresh export within the last 30 days.
- **Manual seed path.** If Foundry is permanently unavailable for the MVP, the support lead seeds 50 to 200 hand-curated tickets directly into `support_eval_runs.regression_set` via a one-shot script. The eval surface (§5.5.3) shows "Manually seeded — last refreshed YYYY-MM-DD" so the source of the regression set is unambiguous to operators.
- **Acceptance criterion adjustment.** §9.2 acceptance "classification accuracy >= 85% per intent" is measured against whatever regression set is current at lock-in time; if neither Foundry nor the manual seed is available at lock-in, lock-in is held and Open Decision 11.5 is escalated to Product. The gate cannot be bypassed by saying "the data wasn't available."

#### 5.5.3 Eval surface

A new admin page at `/operate/agents/support/evals` showing:

- Latest eval run results (classification accuracy per intent; draft quality average)
- Regression set browser (click any ticket to see golden vs current output)
- Drift trend (weekly chart)
- Failure-mode coverage report

#### 5.5.4 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `server/services/supportEvalHarness.ts` | New service: load regression set, run classify, run draft, score | +250 |
| `server/services/supportEvalHarnessPure.ts` | Pure helpers (judge prompt construction, threshold checks, drift math) | +120 |
| `server/services/__tests__/supportEvalHarnessPure.test.ts` | Pure-function tests for thresholds, drift, judge-prompt construction | +160 |
| `server/db/schema/supportEvalRuns.ts` | New table to persist eval results over time | +60 |
| `migrations/<next-available>_support_eval_runs.sql` + `.down.sql` | New migration (number assigned at chunk-build time to avoid collisions; do not pin); the migration creates the table, enables RLS, and applies the standard `org_isolation` policy | +40 |
| `server/config/rlsProtectedTables.ts` | Register `support_eval_runs` per INV-6 | +1 |
| `scripts/gates/verify-support-agent-eval-thresholds.sh` | New CI-only static gate (per §7.3) — fails build when two consecutive eval runs drop below thresholds | +60 |
| `client/src/pages/operate/SupportEvalsPage.tsx` | New admin page | +200 |
| `server/routes/support/supportEvalsRoutes.ts` | New route group | +80 |
| `server/jobs/supportEvalDailyJob.ts` | pg-boss job for daily drift run | +80 |

**Total: ~1,050 LOC.**

### 5.6 UI surfaces

The 8 support UI components from PR #277 are in place. This spec adds the agent-specific surfaces.

#### 5.6.1 Support Agent dashboard

A dashboard page at `/operate/agents/support` showing:

- Status pill per inbox: "Autonomous · 4 drafts pending · 2 sent today · 0 escalations"
- Per-inbox toggle to flip between assisted and autonomous mode (writes to `canonical_inboxes.agent_config.mode`; immediate effect on next agent run)
- Inline link to inbox detail (existing PR #277 surface)
- Inline link to Support Agent Run Trace history
- Inline eval drift indicator (green / amber / red)

#### 5.6.2 Inbox Agent Configuration tab

Extends the existing inbox config UI (PR #277 `inbox-config.html` mockup) with the agent's configuration. All fields write to `canonical_inboxes.agent_config` (`SupportInboxAgentConfig` Zod schema):

- `mode`: `disabled` / `assisted` / `autonomous` (default `disabled`; bumped to `assisted` on agent enablement)
- `collisionWindow.minMinutesSinceHumanActivity`: 5 / 15 / 30 / 60 minutes
- `collisionWindow.respectHumanAssignee`: boolean toggle
- `minConfidence` (additive, new this MVP): 0.7 / 0.8 / 0.9 (default 0.8)
- `voiceProfile` (additive, new this MVP): dropdown (Casual / Neutral / Formal / Custom; default Neutral)
- `promptOverride` (existing): freeform textarea, used as the custom voice prompt when `voiceProfile = Custom`
- `escalationCategories` (additive, new this MVP): multi-select (cancellation_request / complaint / sales_inquiry / other)

#### 5.6.3 Run Trace surfacing

Support Agent runs surface in the Run Trace UI (foundation Item 4). The existing virtual view aggregates the agent's events; this spec adds new event type discriminators. Event names align with the INV-16 stable log code namespace (`phase1.support.*`) so the Run Trace event discriminator and the structured log code are the same string per event.

**Run Trace per-ticket events.** Seven events render in Run Trace; every per-ticket terminal verdict fires exactly one terminal event:

- `phase1.support.ticket_classified` — payload: `{ticketId, intent, urgency, confidence}`. Non-terminal.
- `phase1.support.classify_failed` — payload: `{ticketId, parseError, rawModelOutputRedacted}`. Non-terminal at the per-ticket level (the next renderer is the escalation `ticket_terminal` event with `perTicketVerdict: 'escalated_to_human'`). Per §5.4.1.
- `phase1.support.draft_proposed` — payload: `{ticketId, draftId, controllerStyleAtPropose, riskTierResolved, perTicketVerdict: 'drafted_for_review' | 'drafted_and_dispatched'}`. Terminal for the draft branches.
- `phase1.support.draft_dispatched` — payload: `{draftId, dispatchPhase, idempotencyKey}`. Non-terminal at the per-ticket level (logs the three-phase dispatch step).
- `phase1.support.draft_blocked_by_policy` — payload: `{ticketId, draftId, blockingPolicy}`. Non-terminal.
- `phase1.support.collision_skipped` — payload: `{ticketId, reason: 'concurrent_claim' | 'human_active', lastHumanActivityAgo?, perTicketVerdict: 'skipped_collision'}`. Terminal.
- `phase1.support.ticket_terminal` — payload: `{ticketId, perTicketVerdict: 'escalated_to_human' | 'skipped_low_confidence' | 'skipped_no_action_needed', reason, claimReleasedAt}`. Terminal for every non-draft, non-collision branch. Exactly one of the three Terminal events fires per ticket per agent run.

**42 Macro failure renderers also surface in Run Trace.** Per the canonical event registry in §3.5: `phase1.macro.report_rendering_failed` and `phase1.macro.artifact_upload_failed` render inline in the 42 Macro run's tree-of-decisions view as failure-state events (red icon + retry-context summary). The renderer for these lives in `client/src/components/run-trace/MacroFailureRenderers.tsx` (new, +60 LOC; see §4.6.3 file inventory addition below).

**Admin alert event (NOT Run Trace).** `phase1.support.eval_drift_detected` is emitted by the daily eval job into the Activity feed and admin alerts only; it is not rendered in the per-run Run Trace virtual view (the eval job is not a Support Agent run). Its payload is `{evalRunId, accuracyDelta, judgeScoreDelta, threshold}`.

These slot into the existing Run Trace event renderer with no new UI surface beyond the named renderer files; the existing tree-of-decisions view shows them inline.

#### 5.6.4 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `client/src/pages/operate/SupportAgentDashboard.tsx` | New page | +180 |
| `client/src/components/support/InboxAgentConfigTab.tsx` | Extends PR #277 inbox config | +150 |
| `client/src/components/run-trace/SupportEventRenderers.tsx` | New event renderers for the 7 Run Trace event types in §5.6.3 (6 non-terminal/per-ticket events including `phase1.support.classify_failed` + the `phase1.support.ticket_terminal` terminal); the admin-only `phase1.support.eval_drift_detected` is not rendered here | +160 |
| `server/routes/support/supportAgentRoutes.ts` | Routes for dashboard + config (placed under the existing `server/routes/support/` group; no new `routes/operate/` directory) | +60 |
| `shared/types/supportInboxAgentConfig.ts` | Additive Zod fields: `minConfidence?`, `voiceProfile?`, `escalationCategories?` (per §5.3.2) | +15 |

**Total: ~525 LOC.** No frontend component tests; the route module gets a single integration test alongside other support routes.

### 5.7 Effort estimate for Support Inbox MVP

- New `classify_ticket` skill + cache: 4 to 6 dev-days
- Polished prompts for `propose_reply` and `find_customer_history`: 3 to 5 dev-days (includes LLM iteration)
- Agent definition + master prompt + execution flow: 3 to 5 dev-days
- Eval harness: 5 to 8 dev-days
- UI surfaces: 3 to 4 dev-days

**Total: 18 to 28 dev-days (4 to 6 weeks).** Lower than my original estimate (30 to 46 dev-days) because the canonical layer is already done.

---

## 6. Shared Infrastructure

### 6.1 File Delivery Service

Both MVPs need to deliver files to users (PDF reports, transcripts, attachments). Today's IEE worker writes to `/tmp` which is ephemeral. This section ships a shared file delivery service used by both MVPs.

#### 6.1.1 Storage backend

**Recommended: AWS S3** (or equivalent object store: GCS, Cloudflare R2). The existing infrastructure choice is whatever the worker container can reach with low latency.

Key requirements:
- Per-org bucket prefix: `s3://{bucket}/orgs/{org_id}/runs/{run_id}/{artifact_kind}/{content_hash}.{ext}` — including `artifact_kind` in the path prevents byte-identical artifacts of different kinds (e.g. a transcript and a report that happened to hash the same) from colliding on the storage key. Aligns with the composite DB index in §6.1.2.
- Server-side encryption (SSE-S3 or SSE-KMS)
- Lifecycle rule: source media (videos, raw audio) auto-delete in 7 days; reports (PDFs, transcripts) retain per org policy
- Signed URL TTL: 7 days for reports, 24 hours for raw media
- IAM: worker has write-only role; main app has read-only role for issuing signed URLs

#### 6.1.2 Schema

```sql
-- Migration NNNN_run_artifacts.sql
CREATE TABLE run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,  -- nullable so artifacts can outlive a deleted run row up to retain_until; agent_run deletion clears the FK rather than cascading
  iee_run_id uuid,                              -- nullable; populated for IEE-mode runs
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('report', 'transcript', 'media', 'attachment', 'log')),
  display_name text NOT NULL,                   -- "Report.pdf", "Transcript.srt"
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  content_hash text NOT NULL,                   -- sha256 of bytes
  storage_provider text NOT NULL,               -- 's3' | 'gcs' | 'r2'
  storage_key text NOT NULL,                    -- bucket-relative path
  storage_region text,
  retain_until timestamptz,                     -- null = retain indefinitely per org policy
  download_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX run_artifacts_org_run_idx ON run_artifacts(organisation_id, agent_run_id);
CREATE INDEX run_artifacts_content_hash_idx ON run_artifacts(content_hash);
CREATE INDEX run_artifacts_retain_until_idx ON run_artifacts(retain_until) WHERE retain_until IS NOT NULL;

-- Idempotency: storage keys are unique per (org, run, kind, hash) by construction
-- of the §6.1.1 storage layout, BUT the customer-facing logical idempotency contract
-- is the composite DB index below. Two byte-identical artifacts of different kinds
-- (e.g. a transcript and a report that hashed the same) would collide on storage_key
-- if we keyed only on (provider, key) — and re-running the same agent_run produces
-- an identical row that we want to dedupe via ON CONFLICT DO NOTHING. The composite
-- index gives us both: per-(org,run,kind,hash) uniqueness and a clear logical key
-- for the upload retry path.
CREATE UNIQUE INDEX run_artifacts_run_kind_hash_unique
  ON run_artifacts(organisation_id, agent_run_id, artifact_kind, content_hash)
  WHERE agent_run_id IS NOT NULL;
```

**Why partial on `agent_run_id IS NOT NULL`.** `run_artifacts.agent_run_id` is `ON DELETE SET NULL`; once an `agent_runs` row is hard-deleted by retention, the artifact's `agent_run_id` becomes NULL until §6.1.2b sweeps the orphan. Excluding NULLs from the index keeps the constraint meaningful only while the run lineage is intact, and prevents post-deletion artifacts from blocking new inserts that happen to share `(org, NULL, kind, hash)`.

`run_artifacts` is RLS-protected; registered in `server/config/rlsProtectedTables.ts`.

**Migration failure recovery.** The migration creates the table, the indexes, and the RLS policies in a single transaction; postgres' DDL is transactional, so a partial-state mid-migration is impossible — the migration either fully applies or fully rolls back. Three external-state failure modes are worth calling out:

- **External state (S3 bucket / IAM) not provisioned at migrate time.** The migration creates the database row only; it does NOT touch S3. The MVP's deploy runbook lists S3 bucket + IAM provisioning as a precondition; if missed, the migration applies cleanly and the first artifact upload returns the S3 client error visibly via the existing `phase1.macro.artifact_upload_failed` event. Recovery is "provision S3 + IAM, retry the next agent run." No data corruption.
- **Migration applies but seed data (system Support Agent row) fails.** The Support Agent install seed is a separate idempotent step (per §5.3.1, the install service uses `INSERT ... ON CONFLICT DO NOTHING` keyed on `slug = 'support-agent'`). Retrying the seed is safe.
- **Migration fails mid-deploy.** `.down.sql` reverts the table + indexes + RLS policies; the deploy aborts with the standard pg-boss / migrate runner error path. No application code that references `run_artifacts` is shipped without the table, because the migration runs before the application deploys (existing deploy ordering — see `replit.md`).

The retention sweep (§6.1.2b) does not reference `agent_runs`, so a deploy that fails after `run_artifacts` lands but before the sweeper job ships is safe (rows accumulate; the sweeper picks them up on its first scheduled run). No application-side reconciliation is required.

**Idempotency posture (per checklist §10.1):** key-based on `(organisation_id, agent_run_id, artifact_kind, content_hash)` via the composite partial unique index above. **Retry classification (per checklist §10.2):** `safe` — the worker can retry uploads unconditionally; the unique index guarantees exactly-once row creation per (org, run, kind, hash). **HTTP mapping for `23505` on the artifact upload endpoint:** 200 with the existing row id (idempotent hit), never bubbled as 500. The storage-key path (`orgs/{org_id}/runs/{run_id}/{artifact_kind}/{content_hash}.{ext}`) is unique by construction of the §6.1.1 layout and acts as the physical de-duplication key in S3; the DB composite index is the logical idempotency boundary.

**Source-of-truth precedence vs `iee_artifacts`.** `iee_artifacts` remains the worker-internal ledger of raw artifacts produced during IEE execution (used by IEE progress UI, transcription cache, dedup-by-content-hash inside the worker). `run_artifacts` is the customer-delivery ledger — only entries the customer can download via signed URL. When an IEE artifact is promoted to customer delivery, the worker copies the bytes to S3 and inserts a new `run_artifacts` row referencing the same `iee_run_id` plus the same `content_hash`; the original `iee_artifacts` row is never moved. Customer-facing UI reads `run_artifacts` only; the worker reads `iee_artifacts` only. No automatic backfill of pre-MVP `iee_artifacts` rows; only artifacts produced after the MVP ships appear in `run_artifacts`.

**Drift handling between the two ledgers.** Promotion is not transactional across worker-internal `iee_artifacts` and customer-facing `run_artifacts`, so partial failure can leave a row in one and not the other. The MVP's posture:

- **`iee_artifacts` row exists, `run_artifacts` row missing.** Outcome: customer-facing UI shows nothing; worker UI/cache continues to function. Cause: S3 upload succeeded but `run_artifacts` insert failed, OR run completed before the promotion step ran. The promotion step is idempotent via the §6.1.2 composite partial unique index `(organisation_id, agent_run_id, artifact_kind, content_hash)`; on the next run-completed handler invocation the missing row is created. No special detection job is required — the next happy path re-promotes.
- **`run_artifacts` row exists, `iee_artifacts` row missing.** Outcome: customer-facing UI shows the artifact; worker has no record. Cause: should not happen for MVP-produced artifacts (worker writes `iee_artifacts` first); only possible for artifacts inserted via paths other than the IEE worker (e.g., the main-app PDF renderer, which writes `run_artifacts` directly without an `iee_artifacts` row). This is by design: not every customer artifact has an IEE provenance. `run_artifacts.iee_run_id` is nullable for exactly this case.
- **Detection of orphaned `run_artifacts` rows after run deletion.** When an `agent_runs` row is hard-deleted by retention, `run_artifacts.agent_run_id` SET NULL fires; the orphaned `run_artifacts` rows continue to honour `retain_until` and are swept by §6.1.2b. The `listForRun` query naturally returns nothing for the deleted run.
- **No backfill, no reconciliation worker.** Drift between the two ledgers is bounded (only the promotion-failure case above), self-healing via the next happy path, and visible to the operator via the `phase1.file_delivery.uploaded` event. A reconciliation worker can be added in Phase 2 if drift becomes operationally visible.

#### 6.1.2b Retention sweep (hard-delete)

Phase 1 hard-deletes expired artifacts. The schema has `retain_until` but intentionally has no soft-delete columns (`deleted_at`, `storage_deleted_at`) — adding them costs schema complexity that this MVP does not need. The daily sweeper job:

1. Selects rows with `retain_until < now()` ordered by `retain_until ASC`, in batches.
2. Deletes the S3 object via `DeleteObject`.
3. Deletes the `run_artifacts` row.
4. Emits `phase1.file_delivery.expired` with the row's last-known metadata.

Because the row is hard-deleted, `listForRun` does not need to filter on a deletion column — expired rows simply do not appear. Signed URLs that were issued before deletion will return 403 from S3 once the object is gone; that is acceptable for Phase 1 (signed URLs are short-lived). Phase 2 may add a soft-delete tombstone column if download attribution after expiry becomes a customer requirement.

#### 6.1.3 Service API

```ts
// server/services/fileDeliveryService.ts (new file)

export interface UploadInput {
  organisationId: string;
  agentRunId: string;
  ieeRunId?: string;
  artifactKind: 'report' | 'transcript' | 'media' | 'attachment' | 'log';
  displayName: string;
  mimeType: string;
  contentBuffer: Buffer | NodeJS.ReadableStream;
  retainUntil?: Date;
}

export interface UploadResult {
  artifactId: string;
  contentHash: string;
  sizeBytes: number;
}

export interface SignedUrlOptions {
  expiresIn?: number; // seconds, default 7 days for reports, 24h for media
  inlineDisposition?: boolean; // for inline preview vs download
}

export const fileDeliveryService = {
  async upload(input: UploadInput): Promise<UploadResult>,
  async issueSignedUrl(artifactId: string, organisationId: string, options?: SignedUrlOptions): Promise<{ url: string; expiresAt: Date }>,
  async listForRun(agentRunId: string, organisationId: string): Promise<RunArtifact[]>,
  async deleteByRun(agentRunId: string, organisationId: string): Promise<number>, // for run-level deletion
};
```

#### 6.1.4 Worker integration

The IEE worker produces artifact bytes (transcripts, source media) and delivers them to the `fileDeliveryService.upload` contract. PDF reports are rendered in the main app per §4.4.3 (the worker does not render PDFs), so the worker's only direct upload responsibilities are the transcript and source media.

**Single contract, two physical paths.** Regardless of where the bytes physically transit to S3, the row-insertion into `run_artifacts` and the `phase1.file_delivery.uploaded` event emission ALWAYS happen in the main app (not the worker). This keeps the audit trail single-sourced and aligned with the §6.1.1 IAM model (worker write-only on bytes; main app row-insert + signed-URL issuance).

The two physical-transit options are gated on Open Decision 11.2; both bind to the same logical contract:

- **Option A — direct upload + finalize.** Worker uploads object bytes directly to S3 with worker-scoped IAM (write-only); after the PUT succeeds the worker calls a main-app endpoint `POST /api/internal/run-artifacts/finalize` with the upload metadata; main app verifies the object exists, inserts the `run_artifacts` row, emits `phase1.file_delivery.uploaded`, returns the artifact id.
- **Option B — main-app proxy.** Worker streams bytes to a main-app endpoint `POST /api/internal/run-artifacts/upload`; main app does the S3 write, the row insert, and event emission inside the same request handler.

Option A is the steady-state target; Option B is a viable Phase 1 fallback if worker-scoped IAM is not yet provisioned. The choice does not change the row shape, the event payload, or the signed-URL issuance flow downstream — only where the bytes physically transit.

#### 6.1.5 UI integration

The Run Trace artifacts panel (Section 4.5.2) calls `GET /api/agent-runs/:runId/artifacts` which internally calls `fileDeliveryService.listForRun` and returns artifacts with signed URLs. The existing PDF embed and download primitives in `consolidation-foundation` render the artifacts.

#### 6.1.5b file_delivery event payload contracts

INV-16 lists four `phase1.file_delivery.*` events. Their payload contracts and emit points:

| Event | Emitter | Emit point | Payload |
|---|---|---|---|
| `phase1.file_delivery.uploaded` | Main app `fileDeliveryService.upload` (Option B) or finalize endpoint (Option A); never the worker | After the `run_artifacts` insert returns | `{artifactId, organisationId, agentRunId?, ieeRunId?, contentHash, sizeBytes, storageProvider, storageKey, mimeType, artifactKind}` |
| `phase1.file_delivery.signed_url_issued` | Main app `fileDeliveryService.issueSignedUrl` | After signing (before returning to caller) | `{artifactId, organisationId, expiresAt, inlineDisposition, requestSource: 'run_trace_panel' \| 'pdf_embed' \| 'copy_link' \| 'api_consumer'}` |
| `phase1.file_delivery.downloaded` | Main-app download proxy at `GET /api/run-artifacts/:id/download` (the proxy follows the signed-URL exchange and streams bytes back) | When the bytes are actually fetched (not on URL issuance — that's the previous event) | `{artifactId, organisationId, downloaderUserId?, byteCount, durationMs}` |
| `phase1.file_delivery.expired` | Main-app daily sweeper job that runs against `run_artifacts` rows where `retain_until < now()` | When the sweeper deletes the S3 object and removes the row (Phase 1 hard-deletes per §6.1.6b) | `{artifactId, organisationId, retainUntil, ageDays}` |

All four events emit from the main app. The download proxy (`GET /api/run-artifacts/:id/download`) is the only practical route to per-download attribution without infrastructure work, so Phase 1 mandates it for the Preview / Download paths in §4.5.2. The signed-URL mint endpoint (`POST /api/run-artifacts/:id/signed-url`) is the Copy-link path: it issues a sharable URL for users to send outside the app and emits `signed_url_issued` only — downloads via the copied URL bypass the proxy and DO NOT emit `phase1.file_delivery.downloaded`. This is the explicit attribution trade-off (per §4.5.2): a sharable URL cannot also be tracked. `expired` is best-effort observability; the spec does not gate any behaviour on it.

#### 6.1.6 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `migrations/<next-available>_run_artifacts.sql` + `.down.sql` | New table + composite partial unique index + RLS policy. **Migration number assigned at chunk-build time to avoid collisions; do not pin the placeholder.** Same convention as the §5.5.4 `support_eval_runs` migration. | +60 |
| `server/db/schema/runArtifacts.ts` | Drizzle schema | +50 |
| `server/services/fileDeliveryService.ts` | Service + S3 client integration | +280 |
| `server/services/__tests__/fileDeliveryServicePure.test.ts` | Pure-function tests: storage-key derivation (org/run/kind/hash path), signed-URL TTL math, retain-until calculation | +120 |
| `server/services/__tests__/fileDeliveryService.integration.test.ts` | Single integration test: upload + signed URL + download round-trip against a local S3 mock | +120 |
| `server/config/rlsProtectedTables.ts` | Register new table | +1 |
| `worker/src/lib/uploadArtifact.ts` | Worker-side upload helper | +80 |
| (artifact list + download proxy + signed-URL mint routes) | Counted in §4.5.3 code-changes table — not duplicated here | (already counted) |

**Total: ~710 LOC** (excluding the routes counted in §4.5.3).

#### 6.1.7 Effort estimate

**8 to 12 dev-days.** Risk: medium. S3 IAM setup and signed URL flow can be fiddly; the rest is straightforward CRUD.

### 6.2 Shared between MVPs

| Concern | Both MVPs share | Notes |
|---|---|---|
| File delivery (Section 6.1) | Yes | 42 Macro: PDF report + transcript. Support Inbox: customer attachment passthrough (Phase 2 deepens this) |
| Approval UX | Yes | Existing review queue + Slack Block Kit; no new shared code |
| Run Trace event types | Yes | Both MVPs emit through the foundation virtual view; their event types are distinct |
| `controllerStyle = 'native'` default | Yes | Both MVPs are deterministic Native runs |
| Risk Tier classification | Yes | Both MVPs' actions inherit the foundation's tier convention |
| `CredentialBrokerService` | Yes | 42 Macro: web_login credentials. Support Inbox: Teamwork OAuth credentials |
| Policy Envelope snapshot | Yes | Both MVPs surface the snapshot in Run Trace |

---

## 7. Test Strategy

### 7.1 Test posture (per `docs/spec-context.md`)

Static-gates-primary, pure-function unit tests, no frontend/E2E/API-contract tests for the app itself. This MVP follows the same posture as the foundation refactor:

- **Pure-function unit tests** (Vitest): PDF rendering determinism, classification scoring math, eval harness threshold logic, signed-URL generation, optimistic-claim predicate construction, redaction in agent prompts.
- **Targeted integration tests** (Vitest, narrow): one for the worker → S3 upload → signed URL round-trip; one for the per-ticket atomic-claim contention case (two simultaneous runs against the same ticket). These are the two hot paths where pure tests cannot exercise the contract.
- **New static gates** (`scripts/gates/`): `verify-support-agent-eval-thresholds.sh` (added by §5.5.4) is a CI-only static gate that reads the most recent eval run row and fails the build when classification accuracy or draft-judge score drops below the configured threshold. CI runs the gate; nobody runs it locally per the project test-gate policy.
- **Manual smoke tests** before merge (§7.5).

No frontend unit tests, no React component tests, no E2E tests of the Automation OS app. The framing assumption (`frontend_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`) is unchanged.

### 7.2 New test files

| Test file | Coverage |
|---|---|
| `server/services/__tests__/reportRenderingServicePure.test.ts` | PDF rendering math: layout deterministic, content-hash stability across re-renders for the same input |
| `server/services/__tests__/fileDeliveryServicePure.test.ts` | Storage-key derivation, signed-URL TTL math, retain-until calculation |
| `server/services/__tests__/fileDeliveryService.integration.test.ts` | Single integration test: upload + signed URL + download round-trip against a local S3 mock |
| `server/services/__tests__/supportClassifyTicketPure.test.ts` | Pure scoring helpers; intent enum coverage on a small fixture set |
| `server/services/__tests__/supportEvalHarnessPure.test.ts` | Threshold checks, drift detection math, judge-prompt construction |
| `server/services/__tests__/supportAgentClaimPure.test.ts` | Optimistic-claim predicate construction, TTL math, terminal-verdict enum coverage |
| `server/services/__tests__/supportAgentClaim.integration.test.ts` | Single integration test: two concurrent agent runs targeting the same ticket; exactly one wins the claim, the other emits `phase1.support.collision_skipped` |

### 7.3 Eval-as-static-gate

The Support Agent eval harness (Section 5.5) doubles as the only meaningful regression check for agent-quality drift. The CI gate `scripts/gates/verify-support-agent-eval-thresholds.sh` (authored as part of §5.5.4) is CI-only and operates against the `support_eval_runs` table.

**Minimal `support_eval_runs` row shape** (consumed by the gate; full schema lives in `server/db/schema/supportEvalRuns.ts`):

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid PK | row identity |
| `organisation_id` | uuid (RLS) | tenant scope |
| `run_at` | timestamptz | when the eval ran (used for "two consecutive" ordering: `ORDER BY run_at DESC LIMIT 2`) |
| `classification_accuracy_per_intent` | jsonb | map of intent → accuracy (0..1); the gate fails if any intent value is below the configured min |
| `draft_judge_score_avg` | numeric | average judge score (0..5); the gate fails if below the configured min |
| `threshold_classification_min` | numeric | the threshold this row was scored against (snapshotted at eval time) |
| `threshold_judge_min` | numeric | judge threshold snapshotted at eval time |

**Gate logic.** The gate fetches the two most recent `support_eval_runs` rows ordered by `run_at DESC`. The build fails iff BOTH rows are below threshold for the same metric (classification or judge). Single-run dips do not fail the build (avoids judge-variance noise). **Fresh-CI / missing-rows behaviour:** if fewer than two rows exist, the gate exits 0 (fail-open). This matches Phase 1 posture — until the daily eval job runs at least twice we have no signal, and blocking CI during that window would block all merges to main. Once the second eval row exists the gate becomes effective. The fail-open is logged so the operator can spot a stuck eval job.

CI runs the gate; nobody runs it locally per the project test-gate policy.

### 7.4 Existing tests

Every existing Vitest test must continue to pass. Specifically:
- All foundation refactor tests (locked)
- All Support Desk Canonical tests from PR #277 (locked)
- All existing IEE browser worker tests (no behaviour change)

### 7.5 Smoke test scenarios

Five scenarios before merge:

1. **42 Macro run, happy path**: scheduled run completes; PDF report uploaded; signed URL works; Run Trace headline shows "Report ready · Download".
2. **42 Macro run, login failure**: simulated login change; agent emits `phase1.macro.login_failed`; admin alert fires; no PDF produced.
3. **Support Agent assisted-mode triage**: seeded inbox with 3 tickets; agent classifies all 3; drafts replies for 2; flags 1 for human; review queue shows the 2 drafts; approving sends through three-phase dispatch; messages appear in `canonical_ticket_messages`.
4. **Support Agent autonomous-mode**: same setup but inbox `mode=autonomous`; agent auto-approves drafts; replies dispatch without human; Run Trace shows the policy-override decisions.
5. **Support Agent collision avoidance**: human edits a ticket within the collision window; agent run skips the ticket; emits `phase1.support.collision_skipped`; review queue is empty.

**Existing-flow regression smoke tests (no new code; explicit reference to confirm coverage).** The Support Agent assumes the existing review queue + Slack Block Kit HITL flow continues to work unchanged when fed Support Agent–authored drafts. The PR #277 (Support Desk Canonical) test suite already covers the dispatch contract; this MVP adds two narrow smoke checks to confirm the Support Agent's payload shape matches what those existing tests expect:

6. **Slack Block Kit HITL — Support-Agent-authored draft**: a Support Agent run produces a draft in `canonical_ticket_drafts.awaiting_review`; the existing Slack Block Kit notification fires with the standard buttons (Approve / Reject / Edit); pressing Approve in the Slack thread triggers the existing three-phase dispatch and writes a customer-facing reply via Teamwork. Confirms that no payload-shape drift exists between PR #277's draft producer and this MVP's draft producer.
7. **Review queue UI — Support-Agent-authored draft**: a draft authored by the Support Agent appears in the existing review queue UI with the same affordances (preview, edit, approve, reject) as drafts authored via the existing rule-based candidate drafter. Confirms no UI-layer divergence.

These two smoke checks pass at lock-in time; if either fails, the failure indicates a payload-shape mismatch between the new Support Agent and the locked PR #277 contract — root-cause the agent's draft writer, not the dispatch layer.

---

## 8. Rollout Plan

### 8.1 Sequencing

| Block | Predecessors | Weeks |
|---|---|---|
| File delivery infrastructure (Section 6.1) | Foundation refactor | 1 to 2 |
| 42 Macro Full MVP (Section 4) | File delivery | 3 to 5 |
| Support Inbox MVP (Section 5) | Foundation + Support Desk Canonical | 3 to 5 (parallel with 42 Macro) |
| Phase 1 lock-in | Both MVPs | 1 |

Total: **6 to 8 weeks** if both MVPs run in parallel (one engineer per MVP plus one on shared file delivery).

### 8.2 Branch and PR strategy

- Single `claude/phase-1-showcase-mvps-{tbd}` branch.
- One PR per logical chunk; suggest 8 to 12 PRs to keep each reviewable.
- Each PR through spec-conformance, pr-reviewer, dual-reviewer (where Codex available) before merge.

### 8.3 Per-subaccount enablement (no feature flags)

Per the project's pre-production posture, this MVP ships without feature flags. Per-subaccount enablement is achieved through existing behaviour-mode primitives, not boolean flags:

| Control | Mechanism | Default |
|---|---|---|
| Whether the Support Agent runs at all in a subaccount | `subaccount_agents.is_active` (existing column) | `false` until the operator opts the subaccount in |
| Whether the agent dispatches replies autonomously vs always queues for review | `canonical_inboxes.agent_config.mode` ∈ {`disabled`, `assisted`, `autonomous`} (existing field) | `disabled` for new inboxes; bumped to `assisted` when the agent is wired to the inbox |

The artifacts API ships with its migration; it cannot return rows before the migration runs and the read endpoint is harmless against an empty table.

### 8.4 Rollback plan

- Each migration has `.down.sql`.
- Per-subaccount disable: flip `subaccount_agents.is_active=false`. The Support Agent run pauses immediately on the next scheduled tick.
- Per-inbox disable: set `canonical_inboxes.agent_config.mode='disabled'`. The agent skips that inbox on the next run.
- Code revert: standard commit-and-revert; no feature-flag flush needed.

### 8.5 Production verification

After merge:

1. Run all 5 smoke tests on staging.
2. Pilot with one internal subaccount for 1 week.
3. Roll out to early-access customers (one inbox at a time).
4. Monitor `phase1.*` log codes plus eval drift.
5. Lock when 5 customers run successfully for 2 consecutive weeks.

---

## 9. Acceptance Criteria

### 9.1 42 Macro Full MVP

- [ ] Scheduled 42 Macro run completes end-to-end on a real Teamwork-style portal.
- [ ] PDF report renders correctly for the smoke-test scenario, byte-deterministic across re-runs after the §4.4.3 normalization step (timestamps zeroed, xref sorted, `/ID` stripped, library version pinned).
- [ ] PDF + transcript artifacts uploaded to S3 with signed URLs.
- [ ] Run Trace headline shows "Report ready · Download".
- [ ] Artifacts panel renders below the tool tree with Preview / Download / Copy link affordances.
- [ ] Login failure produces a clear failure mode in Run Trace and triggers an admin alert.
- [ ] **Failure-path renderers visible in Run Trace.** Both `phase1.macro.report_rendering_failed` (PDF render exhaustion per §4.4.4) and `phase1.macro.artifact_upload_failed` (S3 upload exhaustion per §4.6.1) render inline in the Run Trace tree-of-decisions view via `MacroFailureRenderers.tsx` (per §5.6.3). Smoke-test scenario 2 covers `login_failed`; a third smoke check (manual: kill the upload mid-flight) covers `artifact_upload_failed`.
- [ ] Stale-run detector (`staleMacroRunDetector`) fires when a run is stuck.
- [ ] No regression on existing 42 Macro run wall-clock duration: 95th percentile end-to-end run time after MVP changes is within 1.25x of the pre-MVP baseline, measured on the staging dogfood run for one week. Baseline captured at the start of the build phase and recorded in `tasks/builds/phase-1-showcase-mvps/progress.md`.

### 9.2 Support Inbox MVP

- [ ] Support Agent record exists with locked master prompt and the 12 listed default skills (11 `support.*` + `ask_clarifying_question`).
- [ ] **Default skill list grep check (NG3 negative test).** `default_system_skill_slugs` for the Support Agent contains NO `web_search` and NO `search_knowledge_base` entry. A static check in `verify-support-agent-skill-set.sh` (or equivalent grep against the seed migration) fails the build if either appears.
- [ ] `support.classify_ticket` skill returns valid output for the regression set; classification accuracy meets the **initial threshold (>= 85% per intent)** OR a tuned-during-pilot threshold formally agreed with Product before lock-in. Threshold is tunable for the duration of the pilot per §10 Risk Register entry "Eval threshold too strict".
- [ ] **Classify-failure escalation path.** A malformed model output for `support.classify_ticket` (null intent, out-of-range confidence, missing required field) emits `phase1.support.classify_failed` and routes the ticket to `add_internal_note + assign(human)` rather than proceeding to drafting. Covered by `supportClassifyTicketPure.test.ts` malformed-output fixtures (per §5.4.1).
- [ ] Support Agent run on a seeded inbox produces drafts in `canonical_ticket_drafts`.
- [ ] Assisted mode: drafts route to review queue and Slack Block Kit; human approval triggers three-phase dispatch.
- [ ] Autonomous mode: agent auto-approves drafts per inbox policy; three-phase dispatch fires without human.
- [ ] Collision avoidance: agent skips tickets where `last_human_activity_at` is within the configured window; emits `phase1.support.collision_skipped`.
- [ ] **Concurrent install race.** Two simultaneous install attempts of the Support Agent against the same `subaccount_id` return exactly one success (200) and one 409 with body `{ error: 'already_installed' }`. The advisory lock + partial unique index in §5.3.1 are both exercised by the integration test `supportAgentInstall.integration.test.ts`.
- [ ] Eval harness runs daily; results visible at `/operate/agents/support/evals`.
- [ ] Drift alert fires when classification accuracy drops > 10% week over week.
- [ ] All 7 Run Trace event types from §5.6.3 render correctly (the 6 non-terminal/per-ticket events including `phase1.support.classify_failed`, plus `phase1.support.ticket_terminal`); the admin-only `phase1.support.eval_drift_detected` surfaces in the Activity feed but is not rendered in Run Trace.
- [ ] Inbox Agent Configuration tab saves per-inbox `agent_config` correctly.

### 9.3 Shared

- [ ] `run_artifacts` table created and RLS-protected; composite partial unique index `run_artifacts_run_kind_hash_unique` enforces per-(org, run, kind, hash) idempotency.
- [ ] `fileDeliveryService` is the only path for artifact upload + signed URL issuance.
- [ ] **Download proxy attribution.** Preview / Download from the Run Trace artifacts panel emits `phase1.file_delivery.downloaded` (proxy path); Copy-link emits `phase1.file_delivery.signed_url_issued` only and downloads via the copied URL DO NOT emit `downloaded` (per §4.5.2 / §6.1.5b attribution trade-off).
- [ ] **Retention sweep.** Daily sweeper job hard-deletes `run_artifacts` rows with `retain_until < now()`, deletes the corresponding S3 object, emits `phase1.file_delivery.expired`, and `fileDeliveryService.listForRun` no longer returns the swept artifact for the affected run.
- [ ] Both MVPs use `controllerStyle: 'native'`.
- [ ] Both MVPs surface decisions through the foundation Run Trace virtual view.
- [ ] All new CI gates pass.
- [ ] No regression on existing tests or gates.

---

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM-as-judge drift on draft quality eval | Medium | Medium | Anchor judges to fixed model + prompt version; alert on judge-score variance |
| Customer voice profile bleeds across inboxes (cross-tenant prompt leak) | Low | High | Per-inbox `agent_config` is RLS-scoped; integration test verifies no cross-inbox prompt material |
| 42 Macro PDF rendering cost is higher than expected | Medium | Low | `@react-pdf/renderer` is JS-native; profile in staging; acceptable threshold defined in Section 4.4.3 |
| File delivery S3 IAM misconfiguration | Medium | High | Staging dry-run before production rollout; per-org bucket prefix prevents cross-tenant access |
| Support Agent collision policy false negatives (agent acts when human is active) | Medium | High | Smoke test 5 specifically verifies this; INV-11 + observability alert |
| Three-phase dispatch idempotency-key mismatch under retries | Low | High | Inherited from PR #277 supportDraftDispatchService; covered by existing tests |
| Eval threshold too strict; agent fails to ship | Low | Medium | Iterative threshold calibration during pilot; threshold reviewable post-merge |
| Drift detection has too many false positives | Medium | Low | Tunable threshold; aggregate over rolling window, not single run |
| Support Agent runs eat token budget faster than expected | Medium | Medium | Per-subaccount budget on `subaccountAgents.tokenBudgetPerRun`; alert at 80% per-month spend |
| `classify_ticket` cache invalidation issues (stale classifications) | Low | Low | Cache key includes last message external id; stale cache impossible by design |
| Foundry-vs-runtime ticket-shape drift surfacing in agent | Low | High | Inherited risk from support-desk-canonical OQ-1; daily cross-check in eval |

---

## 10.5 Deferred Items

Per the spec-authoring checklist § Section 7, every item that prose calls out as "deferred", "later", "Phase N+1 will", "future", or "out of scope" appears here. The Non-Goals in §2.2 and the deferral notes in §1.4 / §5.1.2 are summarised below.

- **SLA tracking primitives.** Phase 1 MVP treats canonical_tickets `sla_due_at` / `sla_breached` / `sla_policy_external_id` as inert provider metadata only. Phase 1.5 or Phase 2 will add SLA classification, age-based escalation, breach alerts, and the supporting dashboards. Reason: §16.2 brief capability not in §18.1 showcase scope.
- **Recurring-problem detection / clustering.** Phase 2 ships clustering of similar tickets, vector embeddings of email bodies, and "these N tickets are the same bug" aggregation. Reason: §16.2 brief capability not in §18.1 showcase scope.
- **Knowledge-base search in the Support Agent.** Phase 1 Support Agent does NOT include `search_knowledge_base` or `web_search` in its default skill set. Phase 2 adds vector search, semantic ranking, and broader knowledge-base lookup. Reason: §16.2 brief capability not in §18.1 showcase scope.
- **Operator Controller for the Support Agent.** Phase 3 will introduce full Operator Controller for support investigation. Phase 1 light Operator escalation = `assign + internal note + Run Trace event` (flag-for-human, not a long-running autonomous loop). Reason: brief §5.2 explicitly defers Operator Controller until Phase 3.
- **Operator Session Identity (ChatGPT OAuth as session-based model identity).** Phase 3 spec, locked in `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` Section 4 Decision 3. Phase 1 uses platform Anthropic API only.
- **PDF report run-over-run delta section.** Phase 2 adds "delta from yesterday" once we have run-over-run comparison data. Phase 1 PDF has a fixed shape per §4.4.2.
- **Dedicated `agentRunCompletedHandler` job.** Phase 1 reuses the existing `server/jobs/ieeRunCompletedHandler.ts`. A dedicated handler may emerge later if non-IEE-mode runs need PDF output; not required for the MVP.
- **Worker-direct S3 IAM.** Open Decision 11.2 — Phase 1 may proxy through the main app if worker-scoped IAM is not already configured; Phase 2 moves to direct upload regardless.
- **Haiku-classify routing.** Open Decision 11.3 — Phase 1 uses Sonnet for both classify and draft; Phase 1.5 adds Haiku-classify routing once cost data is in.
- **Generic skill-result cache.** Open Decision 11.4 ships a dedicated `support_skill_result_cache` if the cache decision lands. Phase 1.5 may merge it into a generic skill-result cache.
- **Run-artifacts retry endpoint.** Phase 1 fails the run on S3 upload error and recovers via re-run. A `retry_after` / partial-state schema arrives only if the simpler approach proves insufficient in production.

---

## 11. Open Decisions

### 11.1 PDF rendering library

**Decision**: `@react-pdf/renderer` (recommended) vs `puppeteer` vs `weasyprint`.

**Recommendation**: `@react-pdf/renderer`. Pure JS, no native deps, deterministic output, version-stable. Trade-off is slightly slower than native Chromium-based renderers, but speed is not the bottleneck.

**Owner**: Architect.

### 11.2 Worker-to-S3 upload path

**Decision**: worker uploads directly to S3 with worker-scoped IAM credentials, OR worker proxies through the main app.

**Discussion**: Direct upload is simpler; main-app proxy adds latency but centralises auditing. The existing worker already has IAM (per `worker/src/config/env.ts`); confirm scope.

**Recommendation**: direct upload with worker-scoped IAM if already configured; otherwise main-app proxy for v1, direct in Phase 2.

**Owner**: Architect + Ops.

### 11.3 Support Agent default model and routing

**Decision**: Claude Sonnet 4.x for both classify and draft, OR Haiku for classify + Sonnet for draft (cost optimisation).

**Discussion**: Haiku is cheaper for classification (high volume per run); Sonnet is better for draft (single per ticket). Splits the cost meaningfully at scale but adds routing complexity.

**Recommendation**: start with Sonnet for both in MVP; add Haiku-classify routing in Phase 1.5 once cost data is available.

**Owner**: Architect + Product.

### 11.4 Classification cache strategy

**Decision**: dedicated cache table OR re-use `agent_run_messages` projection.

**Discussion**: Dedicated cache is cleaner; reuse adds coupling.

**Recommendation**: dedicated `support_skill_result_cache` table keyed by `(skill_slug, content_hash)` with TTL. Phase 1.5 may merge into a generic skill-result cache.

**Owner**: Architect.

### 11.5 Eval regression set source and refresh policy

**Decision**: where does the regression set come from, and how often is it refreshed?

**Discussion**: Foundry export gives historical tickets; refresh weekly or monthly to avoid staleness. Manual curation by support lead for golden draft replies.

**Recommendation**: monthly refresh from Foundry; quarterly manual curation review.

**Owner**: Product + Support lead.

### 11.6 Support Agent UI permission scope

**Decision**: who can toggle inbox mode (assisted vs autonomous)?

**Discussion**: Per support-desk-canonical chatgpt-spec-review R2, mutating ops gated by `support.inbox.configure`. Confirm same here.

**Recommendation**: `support.inbox.configure` permission gates mode toggle; default granted to org admin only.

**Owner**: Product + Architect.

### 11.7 Phase 1.5 inheritance

**Decision**: how much of this spec is reusable for Phase 1.5 use cases?

**Discussion**: Revenue Ops, Research Intelligence, Paid Ads Monitoring all benefit from the file delivery service and the eval harness pattern. The Support Agent's classification + drafting + approval pattern is reusable for Revenue Ops invoice follow-up.

**Recommendation**: do not over-generalise in this spec; let Phase 1.5 specs reference shared primitives. The eval harness (Section 5.5) becomes a reusable primitive when its second consumer arrives.

**Owner**: Architect.

---

## End of spec

This spec is a draft. Lifecycle:

1. Operator review for completeness.
2. spec-reviewer (Codex) loop for technical adjudication.
3. chatgpt-spec-review for external pressure-test.
4. Lock; transition to Phase 2 (build).
5. `feature-coordinator` consumes the locked spec and produces an implementation plan.
6. Builder sub-agents execute the plan chunk-by-chunk.
7. Branch-level review pass: spec-conformance, pr-reviewer, dual-reviewer (if Codex available), adversarial-reviewer (if security surface touched).
8. `finalisation-coordinator` runs the merge-ready pipeline.

Acceptance criteria in Section 9 must be true at merge.
