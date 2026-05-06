# Doc Sync Drift Report — 2026-05-01

**Audit window:** 2026-04-21 → 2026-05-01  
**Target docs:** `docs/capabilities.md`, `docs/frontend-design-principles.md`, `DEVELOPMENT_GUIDELINES.md`, `architecture.md`  
**Candidates examined:** 11 (A1–A8, B1, C1, D1)  
**Session branch:** `claude/agentic-engineering-notes-WL2of`

---

### Fixed in this session

| ID | Doc | Finding | Fix applied |
|----|-----|---------|-------------|
| A2 | `docs/capabilities.md` | v7.1 system-agent skills roster change: 14 new skills added, `update_financial_record` retired (PRs #212/#216). Skills Reference table had none of the new skills and still listed the retired one. | Removed `update_financial_record` from Skills Reference. Added 14 new skills across four sections: `list_my_subordinates` (Agent Collaboration), `generate_invoice` / `send_invoice` / `reconcile_transactions` / `chase_overdue` / `process_bill` / `track_subscriptions` / `prepare_month_end` (new Admin Operations & Finance section), `discover_prospects` / `draft_outbound` / `score_lead` / `book_meeting` (CRM & Contact Management), `score_nps_csat` / `prepare_renewal_brief` (Analytics & Reporting). |
| A5 | `docs/capabilities.md` | Playbook Engine section said "Seven step types" but `invoke_automation` was added as the 8th step type in PR #186 (riley-observations spec §5.2). | Updated count from "Seven" to "Eight" and added `invoke_automation` bullet with full description (registered external automation, input/output mapping, HITL gate resolution by side-effect classification). |
| C1 | `DEVELOPMENT_GUIDELINES.md` | §7 Testing posture still listed `vitest` in the "do not add" ban alongside `jest/playwright/supertest`, and referenced `npx tsx <path>` as the runner for individual tests. PRs #238+#239 shipped Vitest as the canonical runner; `docs/testing-conventions.md` declares "The single permitted runner is Vitest 2.x" with `npx vitest run <file>`. | Removed `vitest` from the ban list; updated runner instruction from `npx tsx <path-to-test-file>` to `npx vitest run <path-to-test-file>`; added pointer to `docs/testing-conventions.md`. |

---

### Escalated to user

| ID | Doc | Finding | Reason for escalation |
|----|-----|---------|----------------------|
| A1 | `docs/capabilities.md` | Agents-as-employees / workspace-identity capability (actor model, provisioning adapters, org chart, email/calendar-per-agent) has no entry in the Operator Experience section. Spec: `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`. | Spec is "Draft v2 (pre spec-reviewer)" — not ratified. Adding a new capabilities section for an unratified spec is a directional call; editorial rules require accuracy and marketing readiness. Re-evaluate after spec-reviewer pass. |
| B1 | `docs/frontend-design-principles.md` | ClientPulse redesign (PR #187) simplified the UI substantially and could serve as a worked example alongside the existing cached-context infrastructure example. Currently no ClientPulse example exists in the doc. | Adding a worked example requires selecting which specific design decisions to highlight and framing them as transferable principles. That is directional editorial work, not mechanical addition. Needs a human author pass. |

---

### Verified current

| ID | Doc | Candidate | Verdict | Notes |
|----|-----|-----------|---------|-------|
| A3 | `docs/capabilities.md` | Live execution log (EventDetailDrawer / Timeline, PR #168) | CURRENT | Capabilities.md "Live Execution Log" entry present and accurate. Spec: `tasks/live-agent-execution-log-spec.md`. |
| A4 | `docs/capabilities.md` | ClientPulse UI simplification (PR #187) | CURRENT | No dedicated capabilities.md entry expected — ClientPulse is a feature area, not a platform capability listed in the product capability registry. |
| A6 | `docs/capabilities.md` | System-monitoring async ingest / DLQ | N/A | Internal infrastructure control (async queue, DLQ backpressure). No user-visible surface; no capabilities.md entry expected per editorial rules. |
| A7 | `docs/capabilities.md` | Rate-limit-buckets (`inboundRateLimiter`) | N/A | Internal technical control per spec. No operator-visible surface. No capabilities.md entry expected. |
| A8 | `docs/capabilities.md` | DelegationGraphView / hierarchical delegation graph | CURRENT | Hierarchical delegation and DelegationGraphView are documented in the Hermes / delegation section of capabilities.md. Entry accurately describes scoped delegation enforcement and the visible delegation graph per run. |
| D1 | `architecture.md` | Skill executor contract change (v7.1) | CURRENT | Architecture.md documents the three-phase pipeline (`processInput`, `processInputStep`, `processOutputStep`). v7.1 adds new handlers and guards inside `skillExecutor.ts` but does not change the documented contract. No update needed. |
