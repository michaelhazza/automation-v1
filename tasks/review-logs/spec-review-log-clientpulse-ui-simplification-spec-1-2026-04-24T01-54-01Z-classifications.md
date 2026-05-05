# Iteration 1 — per-finding classification + disposition

Companion to `spec-review-log-clientpulse-ui-simplification-spec-1-2026-04-24T01-54-01Z.md`. Each entry: Codex (or rubric) finding # → classification → disposition.

---

## Codex findings

### Codex 1 — `/` redirects to `/admin/pulse`; DashboardPage is not mounted at `/`
- Classification: mechanical (factual cross-codebase mismatch)
- Disposition: accept — rewrite §§1.2, 2 route references, and add the router change (point `/` at DashboardPage, move or delete the existing `/admin/pulse → PulsePage` entry) to §10.

### Codex 2 — real pulse routes are `/admin/pulse` and `/admin/subaccounts/:id/pulse`
- Classification: mechanical
- Disposition: accept — rewrite §§0, 1.1, 7.1, G6 to reference both variants and make the retirement decision explicit.

### Codex 3 — G6 curl check is impossible (SPA `<Navigate>` can't emit HTTP 301)
- Classification: mechanical (self-contradicting gate)
- Disposition: accept — rewrite G6 as a SPA redirect verification (visit old URL → UI lands on new URL).

### Codex 4 — AgentRunLivePage is at `/runs/:runId/live`, not `/agent-runs/:runId`
- Classification: mechanical
- Disposition: accept — update §§1.5, 4.3, 4.5, 5 to `/runs/:runId/live`.

### Codex 5 — AgentRunHistoryPage does NOT navigate to the live page
- Classification: mechanical
- Disposition: accept — rewrite §5.3 to drop the misidentified entry point (or rewire it).

### Codex 6 — `GET /api/agent-runs/:id` already exists
- Classification: mechanical
- Disposition: accept — rewrite §5.2 to "reuse existing endpoint; add `eventCount` only if missing".

### Codex 7 — `/api/activity` already exists; "To create" entry is stale
- Classification: mechanical
- Disposition: accept — rewrite §4.2 to "reuse existing `/api/activity`", remove from §10 "To create", potentially move to §10 "To modify" if service changes are required.

### Codex 8 — query shape `sort=desc` and service name `listRecent` are wrong
- Classification: mechanical
- Disposition: accept — align §4.2 to real sort values (`attention_first|newest|oldest|severity`) and real service name (`listActivityItems`).

### Codex 9 — ActivityItem shape is materially wrong
- Classification: ambiguous leaning mechanical
- Disposition: accept — rewrite §4.2 to the real shape and enumerate the additive fields the feed needs. Minimal-change approach.

### Codex 10 — §§4.3–4.5 rely on non-existent fields
- Classification: mechanical (cascades from #9)
- Disposition: accept — grounded once #9 enumerates the additive fields.

### Codex 11 — prefer existing `pulseService` + `/api/pulse/attention` over new `/api/pending-actions`
- Classification: mechanical (framing: prefer existing primitives)
- Disposition: accept — rewrite §§1.1, 2.2 to reuse `pulseService.getAttention()` / `GET /api/pulse/attention`.

### Codex 12 — pending section is under-specified (approve/reject routes, defer endpoint, config-assistant-chat link)
- Classification: mixed — mechanical for the factual parts, AUTO-DECIDE for defer behaviour
- Disposition: accept mechanical parts: (a) replace "config-assistant-chat" with a real target or placeholder TBD; (b) name the approve/reject endpoints by item type using existing primitives where they exist; (c) AUTO-DECIDE: drop Defer 24h for v1 to avoid scope creep (no defer endpoint exists).

### Codex 13 — §1.2 says generic, §2.3 hard-codes — contradiction
- Classification: mechanical
- Disposition: accept — rewrite §1.2 to "v1 ships a hard-coded 2×2 card set; can become data-driven later".

### Codex 14 — `/crm` doesn't exist, `/agents` redirects to `/`
- Classification: mixed — mechanical factual correction + AUTO-DECIDE for what to do with those cards
- Disposition: accept factual correction; AUTO-DECIDE: drop CRM card entirely for v1; Agents card points at `/admin/agents` (real route). Document in Deferred Items.

### Codex 15 — `/api/clientpulse/high-risk` returns empty (TODO); §3.2 data needs aren't backed
- Classification: mechanical (load-bearing claim without mechanism)
- Disposition: accept — add a §3.5 "Backend data additions" subsection pinning the extended response contract, add route + service to §10 "To modify".

### Codex 16 — PendingHero under-specified (drilldown lacks hasPendingIntervention)
- Classification: mechanical (load-bearing claim without mechanism + missing ship gate)
- Disposition: accept — pin the component contract and drilldown API additions; add ship gate.

### Codex 17 — ClientPulseClientsListPage under-specified
- Classification: mechanical
- Disposition: accept — specify endpoint shape, filter/search/load-more semantics; add ship gate.

### Codex 18 — new named components lack prop contracts
- Classification: mechanical
- Disposition: accept — add short prop/data contracts for PendingApprovalCard, WorkspaceFeatureCard, NeedsAttentionRow, SparklineChart.

### Codex 19 — SparklineChart duplicates existing PnlSparkline / ActivityCharts
- Classification: mechanical (framing: prefer existing primitives)
- Disposition: accept — add a "primitives evaluated" note to §3.2 / §10 explaining the decision (reuse PnlSparkline if API fits; otherwise thin wrapper in `client/src/components/clientpulse/`).

### Codex 20 — AdminAgentTemplatesPage.tsx doesn't exist; real files are SubaccountBlueprintsPage + SystemOrganisationTemplatesPage
- Classification: mechanical
- Disposition: accept — update §6.5 and §10.

### Codex 21 — CreateOrgPage.tsx doesn't exist; real target is likely OnboardingCelebrationPage.tsx
- Classification: mechanical
- Disposition: accept — replace CreateOrgPage with OnboardingCelebrationPage; update §10 if §6.8 mandates changes.

### Codex 22 — §6.8 onboarding changes missing from §10
- Classification: mechanical
- Disposition: accept — change §6.8 to "audit-only; no file changes required" (simplest; matches prose intent).

### Codex 23 — `s.contribution` fix ambiguous across §6.2 (drilldown) vs §8.2 (modal)
- Classification: mechanical
- Disposition: accept — split the change: §6.2 names SignalPanel.tsx; §8.2 keeps ProposeInterventionModal.tsx. Add SignalPanel.tsx to §10.

### Codex 24 — G3/G4 require unit tests (framing violation)
- Classification: mechanical (framing: no frontend unit tests)
- Disposition: accept — convert to manual / visual / static checks only.

### Codex 25 — ship-gate coverage gaps (PendingHero, ClientsListPage, non-CP workspace cards, home approve/reject)
- Classification: mechanical
- Disposition: accept — add manual gates for each gap.

### Codex 26 — no canonical Deferred Items section
- Classification: mechanical (checklist compliance)
- Disposition: accept — add §11 Deferred Items consolidating deferred surfaces.

---

## Rubric findings

### R1 — FireAutomationEditor.tsx path drift
- Classification: mechanical
- Disposition: accept — fix §6.6, §8.1, §10.

### R2 — ProposeInterventionModal.tsx path drift
- Classification: mechanical
- Disposition: accept — fix §6.4, §8.2, §10.

### R3 — §1.5 "may" vs G5 mandatory
- Classification: mechanical (self-contradiction)
- Disposition: accept — change §5.1 meta-bar changes from "may" to "will"; keep two-column as "may".

---

## AUTO-DECIDED items (routed to tasks/todo.md)

### AUTO-DECIDED — reject: Defer 24h button on pending approval cards
- Source finding: Codex #12 (sub-part)
- Reasoning: No Defer endpoint exists; introducing one is a scope expansion (new column + route + state semantics). The spec's intent (make pending items actionable from home) still holds without Defer — approve/reject are sufficient primary actions. Dropping Defer is the most conservative minimal change.
- Framing anchor: "no feature flags for new migrations" (adding a Defer endpoint is a new behaviour with migration impact).

### AUTO-DECIDED — reject: CRM workspace card + `/agents` workspace card
- Source finding: Codex #14 (sub-part)
- Reasoning: `/crm` route doesn't exist in the codebase; `/agents` redirects to `/`. Both would need surface work beyond "UI simplification" scope. Drop for v1, mention in Deferred Items, keep only ClientPulse + Settings (both point at real routes) for the v1 workspace grid. The 2×2 grid concept becomes 1×2 for v1 which is fine.
- Framing anchor: "prefer existing primitives" (don't invent UI surfaces for routes that don't exist).
