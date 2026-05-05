# Operator-as-Agency — Status Update After Main Merge

**Date:** 2026-04-21 (after merging origin/main, 1469 commits since branch point)
**Branch:** `claude/codebase-research-report-xQQbg`
**Companion to:** [`operator-as-agency-investigation.md`](./operator-as-agency-investigation.md) and [`existing-event-trigger-infrastructure.md`](./existing-event-trigger-infrastructure.md)

The two earlier reports recommended a set of schema additions, services, skills, jobs, and routes for an operator-as-agency build. Significant work has landed on `main` since — most notably the `workflows-v1` subsystem (30+ service files, new schema migration `0276`) and two prospect-facing skills (`discover_prospects`, `score_lead`).

This report maps each previously-discussed item to its current status: **BUILT**, **PARTIAL**, or **NOT BUILT**. Three parallel investigation agents were run against the merged tree to produce the findings below.

---

## Table of contents

- [Headline status](#headline-status)
- [Schema items](#schema-items)
- [Code-level items](#code-level-items)
- [workflows-v1 deep dive](#workflows-v1-deep-dive)
- [Revised recommendation](#revised-recommendation)
- [What's left to build](#whats-left-to-build)

---

## Headline status

**Three things changed materially during the 1469 commits merged in:**

1. **`workflows-v1` shipped and IS the renamed playbook system.** Migrations 0219 + 0221 renamed `playbook_runs` → `workflow_runs`. `workflowRunService` replaces `playbookRunService`. The old hook (`playbookAgentRunHook.ts`) is replaced by `workflowAgentRunHook.ts`. **Anywhere our earlier reports said "`playbookRunService.startRun(...)`" or "`playbookAgentRunHook`", read "`workflowRunService.startRun(...)`" / "`workflowAgentRunHook`".** The execution model (immutable versioned templates, step-by-step DAG with HITL gates, agent dispatch) is preserved.

2. **An SDR / lead-discovery foundation has been laid but not wired.** Two SKILL.md files (`discover_prospects.md`, `score_lead.md`) and two provider wrappers (`googlePlacesProvider.ts`, `hunterProvider.ts`) plus a stub service (`sdrService.ts`) all exist on disk. None of them are registered in `actionRegistry.ts` or dispatched in `skillExecutor.ts` — they are dead code from a skill-dispatch perspective. The `sdr-agent` system agent is seeded and lists these skills in its YAML, but those skill calls would 404 today.

3. **None of the operator-as-agency-specific schema additions landed.** No `canonical_prospect_profiles`, no `crm_type` on `subaccounts`, no `outreach_sends`, no `org_sending_domains`, no `bd_conversion_events`, no `event_rules`. Highest migration is `0279_task_events.sql`; next free is `0280`.

**Net for the operator-as-agency build:**

- The execution layer is essentially **done** — workflows-v1 covers `start_playbook`, `create_subaccount`, `send_notification`, `update_record`, `start_agent_run`, and CRM primitives as dispatchable steps with HITL gating, approver pools, confidence scoring, and stall notifications.
- The **routing / event-ingestion layer is still completely absent** — no event bus, no `event_rules` table, no webhook-to-workflow wiring. Workflows are still started by direct service calls only (HTTP route, scheduled task, onboarding hook, or `workflow.run.start` skill).
- The **prospect-data layer** (`canonical_prospect_profiles`, conversion event log) and the **outreach tracking layer** (`outreach_sends`, `org_sending_domains`, Resend webhook) are untouched.
- The **SDR skills** are 80% built but unwired — registering them takes <100 lines.

---

## Schema items

*(section appended below)*

---

## Code-level items

*(section appended below)*

---

## workflows-v1 deep dive

*(section appended below)*

---

## Revised recommendation

*(section appended below)*

---

## What's left to build

*(section appended below)*
