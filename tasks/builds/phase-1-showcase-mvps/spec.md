# Phase 1 Showcase MVPs — Implementation Spec

**Status:** Draft v1.0  
**Date:** 2026-05-10  
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
  - [5.4 Skills and execution flow](#54-skills-and-execution-flow)
  - [5.5 Eval and quality harness](#55-eval-and-quality-harness)
  - [5.6 UI surfaces](#56-ui-surfaces)
- [6. Shared Infrastructure](#6-shared-infrastructure)
- [7. Test Strategy](#7-test-strategy)
- [8. Rollout Plan](#8-rollout-plan)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Risk Register](#10-risk-register)
- [11. Open Decisions](#11-open-decisions)

---

## 0. Status, Scope, Anchors

### 0.1 What this spec is

The implementation spec for the two Phase 1 showcase MVPs. It defines code changes, schema additions, UI work, tests, rollout, and acceptance criteria for both MVPs in one document. The two MVPs build in parallel after their dependencies land.

### 0.2 What this spec is not

This is not the foundation refactor spec (already locked, built, merged in PR #279). This is not the Support Desk Canonical spec (already locked, build pending in `tasks/builds/support-desk-canonical/plan.md` via separate `feature-coordinator` run). This is not the Phase 1.5 use case fan-out spec (Revenue Ops, Research, Paid Ads). This is not a Phase 2 sandbox or Phase 3 autonomous-operator spec.

### 0.3 Authority

Where this spec contradicts the v1.2 brief, the v1.2 brief is authoritative for **what** and this spec is authoritative for **how**. Where this spec depends on the Support Desk Canonical layer, that spec is authoritative; this spec consumes it. Where this spec contradicts the foundation refactor, this spec defers (foundation primitives are locked).

### 0.4 Companion artefacts

| Artefact | Location | Purpose |
|---|---|---|
| v1.2 master brief | `docs/synthetos-governed-agentic-os-brief-v1.2.md` | Phase 1 scope and showcase MVP definitions |
| Foundation refactor spec | `tasks/builds/synthetos-foundation-refactor/spec.md` | Locked primitives this MVP consumes |
| Support Desk Canonical spec | `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` | Locked canonical layer the Support Inbox MVP consumes |
| Support Desk Canonical plan | `tasks/builds/support-desk-canonical/plan.md` | 15-chunk build plan for Spec B; the Support Inbox MVP build cannot start until this finishes |
| Naming glossary | `docs/synthetos-nomenclature.md` | Canonical names for foundation primitives |

### 0.5 Naming convention

This spec follows `docs/synthetos-nomenclature.md`. Where a v1.2 brief term differs from a code-level name, the glossary applies. Specifically: "Native Controller" maps to `controllerStyle: 'native'`; "Approval Level" derives from "Risk Tier" plus Policy Envelope; "IEE Execution Plane" includes today's `iee_browser` and `iee_dev` workers.

### 0.6 Sequencing within Phase 1

| Block | Predecessor | Status | Effort |
|---|---|---|---|
| Foundation refactor | none | DONE (PR #279) | (shipped) |
| Support Desk Canonical | Foundation refactor | DONE (canonical schema, services, skills, routes, UI components all merged) | (shipped) |
| File delivery infrastructure (this spec §6) | Foundation refactor | NOT STARTED | 8 to 12 dev-days |
| 42 Macro Full MVP (this spec §4) | File delivery infrastructure | NOT STARTED; ~70% built before this spec | 23 to 36 dev-days |
| Support Inbox MVP (this spec §5) | Support Desk Canonical (now done) + Foundation refactor | NOT STARTED | 18 to 28 dev-days (lower than original estimate because canonical layer is complete) |
| Phase 1 lock-in | Both showcase MVPs | NOT STARTED | 1 week |

The two showcase MVPs can build in parallel once their dependencies are met. File delivery infrastructure is shared and must complete first or alongside.

---

## 1. Background and Motivation

### 1.1 What Phase 1 promised

Per `docs/synthetos-governed-agentic-os-brief-v1.2.md` Section 18.1, Phase 1 ships:

- The foundation refactor (six primitives, BUILT)
- Two showcase MVPs that exercise the foundation across distinct architectural patterns

The showcase MVPs prove the foundation works end-to-end on real customer-facing surfaces. They are the difference between "we shipped plumbing" and "we shipped a product."

### 1.2 Why these two MVPs

- **42 Macro Task** is a deterministic browser automation reference workflow. It exercises Browser Environment, Native Controller, deterministic loop semantics, artifact production, and Run Trace surface. It is mostly built today (~70%) and requires polish + production hardening rather than new feature construction. Shipping it as Full MVP validates the foundation against existing Browser-Native execution patterns.
- **Support Inbox Workflow** exercises a hybrid pattern: Native Controller for triage and template drafting, light Operator escalation for ambiguous cases, HITL approval for customer-facing replies, Slack Block Kit for the human-in-the-loop, Gmail-via-Teamwork for the inbound channel. It runs on the Support Desk Canonical layer (Spec B). Shipping it validates the foundation against an end-to-end agent workflow that touches every layer.

Together they cover: deterministic vs hybrid execution; Native vs Operator controller; Browser vs API+Tool environments; auto-approve vs HITL approval; one-shot artifact production vs ongoing inbox monitoring.

### 1.3 What is already in place from the foundation refactor

- `agent_runs.controller_style` (Native vs Operator); 42 Macro defaults to Native, Support Inbox defaults to Native with Operator escalation per task
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

**NG1. No SLA tracking primitives.** SLA definitions, response-time commitments, escalation triggers based on age, SLA breach alerts: deferred. Acknowledged in Open Decisions; Phase 1.5 or Phase 2 spec.

**NG2. No recurring-problem detection.** Clustering of similar tickets, "these 5 emails are all about the same bug" aggregation, vector embeddings of email bodies: deferred. Phase 2.

**NG3. No vector search over the knowledge base.** The `search_knowledge_base` skill (deferred from the support-desk canonical spec) uses simple keyword search in this MVP. Vector search and semantic ranking: Phase 2.

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

**INV-8. Both MVPs use Native Controller by default.** Per v1.2 brief Section 6.3 ("Native Controller is default. Operator Controller is escalation and adaptive mode"), both MVPs default to `controllerStyle: 'native'`. The Support Agent may set `controllerStyle: 'operator'` per task only when its own classification labels the task as "investigative" — this is the light Operator escalation path; full Operator Controller is Phase 3.

**INV-9. Approval defaults derive from Risk Tier.** Per foundation spec INV-8, this spec must not silently change the existing `gateLevel` for any action. New `support.*` actions inherit Risk Tier per the rubric in `tasks/builds/synthetos-foundation-refactor/spec.md` Section 4.2.3.

**INV-10. Customer-facing communication is Tier 6 by default.** Sending a reply to a customer (via Teamwork Desk) is Tier 6 (audience impact: client messaging). Default `gateLevel` is `block` unless explicit policy allows. Per inbox, the inbox `agent_config.mode = 'autonomous'` is the policy override that lowers approval to `auto`. Default for new inboxes is `assisted` (always require approval).

**INV-11. Three-phase dispatch for all customer-facing replies.** Per the support-desk-canonical spec §5.8, every customer-facing reply goes through preflight checks → durable transition → adapter call. The Support Agent in this spec consumes `supportDraftDispatchService.dispatchDraft` and never writes to `canonical_ticket_messages` directly.

**INV-12. File delivery is content-hashed and attributable.** Every file produced by an MVP run is stored with content hash, originating run id, and originating org id. No ephemeral files surface in customer-facing UI.

### 3.4 Process constraints

**INV-13. Both MVPs build in parallel after dependencies land.** No artificial sequencing; if the team has capacity for two parallel workstreams, run them. File delivery infrastructure may serialise the two MVPs briefly (one of them lands first; the other lands after).

**INV-14. CI gates must stay green throughout.** Same as the foundation refactor INV-15.

**INV-15. Eval harness is part of acceptance.** The Support Agent does not ship without an eval harness: a regression set of tickets, accuracy thresholds for classify/draft, drift detection. 42 Macro does not need an eval harness (deterministic).

### 3.5 Observability constraints

**INV-16. Stable log codes.** New log codes follow the `phase1.<area>.<event>` pattern:

- `phase1.macro.run_started`, `phase1.macro.run_completed`, `phase1.macro.artifact_delivered`
- `phase1.support.ticket_classified`, `phase1.support.draft_proposed`, `phase1.support.draft_dispatched`, `phase1.support.draft_blocked_by_policy`, `phase1.support.eval_drift_detected`
- `phase1.file_delivery.uploaded`, `phase1.file_delivery.downloaded`, `phase1.file_delivery.signed_url_issued`, `phase1.file_delivery.expired`

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

| File | Change | Rough LOC |
|---|---|---|
| `server/services/reportRenderingService.ts` | New service: `renderMacroReportPdf(input: MacroReportInput): Promise<Buffer>` | +200 |
| `server/services/reportTemplates/MacroReport.tsx` | React component for the PDF template | +180 |
| `server/services/__tests__/reportRenderingService.test.ts` | Pure tests (golden PDF byte check, content-hash determinism) | +80 |
| `server/jobs/agentRunCompletedHandler.ts` | After 42 Macro run completes, call `reportRenderingService.renderMacroReportPdf` and persist via file-delivery service | +30 |

**Total: ~490 LOC.**

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

The "Preview" button opens an inline PDF viewer (existing `PDFEmbed` primitive in `consolidation-foundation`). The "Copy link" button copies a signed URL valid for 7 days.

#### 4.5.3 Implementation

| File | Change | Rough LOC |
|---|---|---|
| `client/src/components/run-trace/RunTraceArtifactsPanel.tsx` | New component | +120 |
| `client/src/components/run-trace/RunTraceHeadline.tsx` | Add artifact-ready badge inline | +20 |
| `client/src/lib/api/runArtifacts.ts` | New API client wrapper | +30 |
| `server/routes/agentRuns.ts` | New route `GET /api/agent-runs/:runId/artifacts` returning artifact list with signed URLs | +40 |
| Tests | Component and route tests | +100 |

**Total: ~310 LOC.**

### 4.6 Production hardening

#### 4.6.1 Retry and degradation policy

| Failure mode | Detection | Action |
|---|---|---|
| Login change (selector miss, post-login probe fails) | `performLoginWithRetry` exhausted | Run terminates with `failureReason: 'login_failed'`; `phase1.macro.login_failed` log; admin notified via existing alert path |
| Page structure change (extract returns no candidates) | Skill returns "no video found" | Run terminates with `failureReason: 'page_structure_change'`; admin notified |
| Transcription failure | Whisper API retry exhausted | Run continues with `transcript: null`; report says "Transcription unavailable; raw audio file is attached" |
| S3 upload failure | Signed URL fetch fails | Run continues; artifact metadata persisted; download UI shows "Retry upload" affordance |
| Provider rate limit | Existing `withBackoff` with capped retry window | Run pauses up to N minutes; surfaces as "rate-limited" in Run Trace |

#### 4.6.2 Observability for stuck runs

A new `phase1.macro.run_stuck` log code fires when a 42 Macro run has been on the same step for longer than `MACRO_STUCK_THRESHOLD_MS` (default 15 minutes). The existing system-monitoring detector (`server/services/systemMonitoring/detectors/`) gains a `staleMacroRun` detector. Phase 1 surfaces the alert in the Activity feed; Phase 1.5 may add an automated recovery action.

#### 4.6.3 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `worker/src/browser/macroExecutor.ts` (or equivalent existing file) | Add explicit failure-mode branches per the table above | +60 |
| `server/services/systemMonitoring/detectors/staleMacroRunDetector.ts` | New detector | +80 |
| Tests | Failure-mode integration tests | +120 |

**Total: ~260 LOC.**

### 4.7 Effort estimate for 42 Macro Full MVP

- File delivery infrastructure (Section 6, shared): 8 to 12 dev-days
- PDF report generation: 6 to 10 dev-days
- Artifact viewer UI: 4 to 6 dev-days
- Production hardening: 5 to 8 dev-days

**Total: 23 to 36 dev-days (5 to 8 weeks).**

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

A new row in `system_agents` with these properties:

| Field | Value |
|---|---|
| `slug` | `support-agent` |
| `display_name` | "Support Agent" |
| `master_prompt` | locked, system-managed (Section 5.3.2 below) |
| `default_system_skill_slugs` | `['support.list_open_tickets', 'support.read_thread', 'support.classify_ticket', 'support.propose_reply', 'support.add_internal_note', 'support.assign', 'support.set_status', 'support.tag', 'support.approve_draft', 'support.reject_draft', 'support.find_customer_history', 'ask_clarifying_question', 'web_search']` |
| `default_org_skill_slugs` | empty (org admins do not extend support skills) |
| `default_execution_mode` | `'api'` (Native style) |
| `default_controller_style` | `'native'` |
| `default_model` | platform Anthropic (Claude Sonnet 4.x) |
| `is_singleton` | `true` (one Support Agent per subaccount) |

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
- ask_clarifying_question     (only when context is genuinely missing; not a default)

## Rules
1. Always classify before drafting.
2. If `last_human_activity_at` is within {{collision_window_min}} minutes, DO NOT act.
3. Customer-facing replies (visibility=public) are always Tier 6; approval policy comes from inbox config.
4. Internal notes (visibility=internal) are Tier 2; auto-approve.
5. Status changes and tags are Tier 2; auto-approve.
6. Reassignment to a human is Tier 1; auto-approve.
7. Use customer history (find_customer_history) for any classified-as-account-issue ticket.
8. Escalate to a human (assign + add_internal_note) when:
   - Confidence below {{min_confidence}}
   - Ticket category in {{escalate_categories}}
   - Customer is high-priority (find_customer_history reports flag)

## Output style
- Replies match {{voice_profile}} (sentence length, tone, sign-off)
- Internal notes are terse and factual
- Always cite the source thread message id when referencing a customer's words
```

The `{{ ... }}` placeholders are filled at run start from `canonical_inboxes.agent_config`. The voice profile is per-inbox overrideable.

#### 5.3.3 Execution flow per ticket

1. Agent run starts; loads inbox config, policy envelope, master prompt with placeholders filled.
2. `support.list_open_tickets(inbox_id)` returns N tickets needing attention.
3. For each ticket, in order:
   - `support.read_thread(ticket_id)` loads the conversation history.
   - `support.classify_ticket(ticket_id)` returns `{intent, urgency, recommended_action, confidence}`.
   - **Collision check**: if `last_human_activity_at` is fresh (within inbox `min_minutes_since_human_activity`), the agent skips this ticket and emits `phase1.support.collision_skipped`.
   - **Confidence check**: if confidence below `min_confidence`, the agent calls `support.add_internal_note` with classification reasoning + `support.assign(human)` and skips drafting.
   - **Account-issue check**: if classified as account/billing/escalation, call `support.find_customer_history` and incorporate into draft.
   - **Drafting**: call `support.propose_reply` to write a `canonical_ticket_drafts` row.
   - **Approval routing**: per inbox `agent_config.mode`:
     - `autonomous`: call `support.approve_draft` → three-phase dispatch fires automatically.
     - `assisted`: leave the draft in `awaiting_review` state; the existing review queue + Slack Block Kit flow takes over.
4. Agent run terminates; Run Trace shows the per-ticket decision tree.

#### 5.3.4 Why this is Native Controller, not Operator

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
| `support.approve_draft` | 6 | block unless inbox `mode=autonomous` policy override |
| `support.reject_draft` | 1 | auto |

Risk Tier 6 on `approve_draft` is the gating control: in `assisted` mode the action is blocked, kicking the draft to the review queue. In `autonomous` mode the per-inbox `agent_config.mode` policy override lowers it to `auto`.

#### 5.4.3 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `server/skills/support/classify-ticket.md` | New skill spec | +110 |
| `server/services/skillHandlers/supportClassifyTicket.ts` | LLM-backed classify implementation | +180 |
| `server/services/__tests__/supportClassifyTicket.test.ts` | Unit tests with fixture tickets | +120 |
| `server/config/actionRegistry.ts` | Register the new skill with `riskTier: 1` | +15 |
| `server/db/schema/agentSkills.ts` (or wherever skill registration lives) | Register skill | +5 |
| `server/services/skillResultCache.ts` (NEW) | Lightweight cache for classification results | +90 |
| Tests | Cache and dispatch tests | +80 |

**Total: ~600 LOC for the new skill.**

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
| Classification accuracy | Per-intent precision + recall against the golden set; threshold: >= 85% per intent in v1 |
| Draft quality | LLM-as-judge scoring against rubric (helpfulness, tone match, factual accuracy); threshold: >= 4.0 / 5.0 average |
| Drift detection | Daily run of regression set against current model + prompt; alert if scores drop > 10% week over week |
| Failure-mode coverage | Tickets that should escalate (confidence below threshold) are escalated; tickets where the agent should NOT act (collision window) are skipped |

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
| `server/services/supportEvalHarnessPure.ts` | Pure helpers (judge prompt construction, threshold checks) | +120 |
| `server/db/schema/supportEvalRuns.ts` | New table to persist eval results over time | +60 |
| `migrations/0313_support_eval_runs.sql` + `.down.sql` | New migration | +40 |
| `client/src/pages/operate/SupportEvalsPage.tsx` | New admin page | +200 |
| `server/routes/support/supportEvalsRoutes.ts` | New route group | +80 |
| `server/jobs/supportEvalDailyJob.ts` | pg-boss job for daily drift run | +80 |
| Tests | Pure tests + integration | +200 |

**Total: ~1,030 LOC.**

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

Extends the existing inbox config UI (PR #277 `inbox-config.html` mockup) with the agent's configuration:

- Mode: `assisted` (default) / `autonomous`
- Collision window: 5 / 15 / 30 / 60 minutes
- Min confidence: 0.7 / 0.8 / 0.9
- Voice profile: dropdown (Casual / Neutral / Formal / Custom)
- Custom voice prompt (textarea, only when Voice profile = Custom)
- Escalation categories: multi-select (cancellation_request / complaint / sales_inquiry / other)

#### 5.6.3 Run Trace surfacing

Support Agent runs surface in the Run Trace UI (foundation Item 4). The existing virtual view aggregates the agent's events; this spec adds a new event type discriminator:

- `support.ticket_classified` — payload: `{ticketId, intent, urgency, confidence}`
- `support.draft_proposed` — payload: `{ticketId, draftId, controllerStyleAtPropose, riskTierResolved}`
- `support.draft_dispatched` — payload: `{draftId, dispatchPhase, idempotencyKey}`
- `support.draft_blocked_by_policy` — payload: `{ticketId, draftId, blockingPolicy}`
- `support.collision_skipped` — payload: `{ticketId, lastHumanActivityAgo}`

These slot into the existing Run Trace event renderer with no new UI surface; the existing tree-of-decisions view shows them inline.

#### 5.6.4 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `client/src/pages/operate/SupportAgentDashboard.tsx` | New page | +180 |
| `client/src/components/support/InboxAgentConfigTab.tsx` | Extends PR #277 inbox config | +150 |
| `client/src/components/run-trace/SupportEventRenderers.tsx` | New event renderers for the 5 new event types | +120 |
| `server/routes/operate/supportAgentRoutes.ts` | Routes for dashboard + config | +60 |
| Tests | Component + route tests | +180 |

**Total: ~690 LOC.**

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
- Per-org bucket prefix: `s3://{bucket}/orgs/{org_id}/runs/{run_id}/{content_hash}.{ext}`
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
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
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
```

`run_artifacts` is RLS-protected; registered in `server/config/rlsProtectedTables.ts`.

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

The IEE worker writes artifacts to `/tmp`, then calls `fileDeliveryService.upload` via a worker-local path that proxies to the main app (since the worker doesn't have direct S3 credentials). Alternative: the worker uploads directly to S3 with worker-scoped IAM credentials. Choice depends on existing worker IAM setup.

**Open Decision:** see Section 11.2.

#### 6.1.5 UI integration

The Run Trace artifacts panel (Section 4.5.2) calls `GET /api/agent-runs/:runId/artifacts` which internally calls `fileDeliveryService.listForRun` and returns artifacts with signed URLs. The existing PDF embed and download primitives in `consolidation-foundation` render the artifacts.

#### 6.1.6 Code changes

| File | Change | Rough LOC |
|---|---|---|
| `migrations/NNNN_run_artifacts.sql` + `.down.sql` | New table | +60 |
| `server/db/schema/runArtifacts.ts` | Drizzle schema | +50 |
| `server/services/fileDeliveryService.ts` | Service + S3 client integration | +280 |
| `server/services/__tests__/fileDeliveryService.test.ts` | Unit + integration tests | +180 |
| `server/config/rlsProtectedTables.ts` | Register new table | +1 |
| `worker/src/lib/uploadArtifact.ts` | Worker-side upload helper | +80 |
| `server/routes/agentRuns.ts` | New `/artifacts` route handler (Section 4.5.3) | +40 |
| Tests | E2E test: worker writes, main app issues signed URL, download succeeds | +120 |

**Total: ~810 LOC.**

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

### 7.1 Test pyramid

Same as the foundation refactor (Vitest, scope-tagged):

- **Pure tests**: PDF rendering determinism, classification function purity, eval harness scoring math, signed URL generation logic
- **Integration tests**: end-to-end 42 Macro run, end-to-end Support Inbox triage cycle, file upload + download flow
- **Component tests**: Run Trace artifacts panel, Support Agent dashboard, eval surface
- **Smoke tests**: full run on staging before merge

### 7.2 New test files

| Test file | Coverage |
|---|---|
| `server/services/__tests__/reportRenderingService.test.ts` | PDF byte determinism, content-hash stability |
| `server/services/__tests__/fileDeliveryService.test.ts` | Upload, signed URL, list, delete |
| `server/services/__tests__/supportClassifyTicket.test.ts` | Classification accuracy on fixture set |
| `server/services/__tests__/supportEvalHarness.test.ts` | Threshold checks, drift detection |
| `client/src/components/run-trace/__tests__/RunTraceArtifactsPanel.test.tsx` | Artifact list rendering, signed URL fetch, preview |
| `client/src/pages/operate/__tests__/SupportAgentDashboard.test.tsx` | Inbox status pill, mode toggle |
| `client/src/components/support/__tests__/InboxAgentConfigTab.test.tsx` | Per-inbox config save |
| `tests/integration/macroRunEndToEnd.test.ts` | Full 42 Macro run with mocked browser + S3 |
| `tests/integration/supportTriageEndToEnd.test.ts` | Full Support Agent triage cycle with seeded tickets |

### 7.3 Eval-as-test

The Support Agent eval harness (Section 5.5) doubles as a regression test. Daily eval runs that drop below thresholds fail the build for that day's deploy candidate (CI gate `verify-support-agent-eval-thresholds.sh`).

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

### 8.3 Feature flags

| Flag | Default | Cleanup |
|---|---|---|
| `RUN_ARTIFACTS_API_V1` | off until file delivery ships | on after one week of dogfooding |
| `SUPPORT_AGENT_ENABLED_PER_SUBACCOUNT` | off (per-subaccount opt-in) | per-subaccount; permanent flag for customer rollout control |
| `SUPPORT_AGENT_AUTONOMOUS_MODE_ALLOWED` | true (gated by inbox config anyway) | always on; flag for emergency disable |

### 8.4 Rollback plan

- Each migration has `.down.sql`.
- Feature flags allow per-customer rollback without code revert.
- The Support Agent run can be paused per-subaccount by flipping the agent's `is_active=false` on `subaccount_agents`.

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
- [ ] PDF report renders correctly for the smoke-test scenario, byte-deterministic across re-runs.
- [ ] PDF + transcript artifacts uploaded to S3 with signed URLs.
- [ ] Run Trace headline shows "Report ready · Download".
- [ ] Artifacts panel renders below the tool tree with Preview / Download / Copy link affordances.
- [ ] Login failure produces a clear failure mode in Run Trace and triggers an admin alert.
- [ ] Stale-run detector (`staleMacroRunDetector`) fires when a run is stuck.
- [ ] All performance baselines from the foundation refactor remain within tolerance.

### 9.2 Support Inbox MVP

- [ ] Support Agent record exists with locked master prompt and the 13 listed skills.
- [ ] `support.classify_ticket` skill returns valid output for the regression set with >= 85% accuracy per intent.
- [ ] Support Agent run on a seeded inbox produces drafts in `canonical_ticket_drafts`.
- [ ] Assisted mode: drafts route to review queue and Slack Block Kit; human approval triggers three-phase dispatch.
- [ ] Autonomous mode: agent auto-approves drafts per inbox policy; three-phase dispatch fires without human.
- [ ] Collision avoidance: agent skips tickets where `last_human_activity_at` is within the configured window; emits `phase1.support.collision_skipped`.
- [ ] Eval harness runs daily; results visible at `/operate/agents/support/evals`.
- [ ] Drift alert fires when classification accuracy drops > 10% week over week.
- [ ] All 5 new event types render correctly in Run Trace.
- [ ] Inbox Agent Configuration tab saves per-inbox `agent_config` correctly.

### 9.3 Shared

- [ ] `run_artifacts` table created and RLS-protected.
- [ ] `fileDeliveryService` is the only path for artifact upload + signed URL issuance.
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
