# Existing Event/Trigger Infrastructure — Exploration Report

**Scope:** read-only inventory of every existing event-driven / trigger / automation-rule subsystem in the codebase.
**Purpose:** decide whether a new generic `event_rules` subsystem can be built by extending what exists, or must sit alongside it as a new table and service.
**Branch:** `claude/codebase-research-report-xQQbg`
**Date:** 2026-04-21
**Executor:** Claude Code main session, orchestrating three parallel read-only Explore agents.

This report is the companion to [`operator-as-agency-investigation.md`](./operator-as-agency-investigation.md). That report recommended a new `conversion_rules` table (Q4) for BD-specific email-reply-positive → create-subaccount routing. The question this report answers is broader: **should that new table actually be generic (`event_rules`) across all event types and actions, and if so, is there an existing subsystem it can extend?**

Every finding cites specific files and line numbers so the extend-vs-build decision can be made from the evidence without re-exploring the codebase.

---

## Table of contents

- [How to read this report](#how-to-read-this-report)
- [Area 1 — `agent_triggers` + `triggerService`](#area-1--agent_triggers--triggerservice)
- [Area 2 — `scheduled_tasks` + `scheduledTaskService`](#area-2--scheduled_tasks--scheduledtaskservice)
- [Area 3 — `onboarding_bundle_configs` + `subaccountOnboardingService`](#area-3--onboarding_bundle_configs--subaccountonboardingservice)
- [Area 4 — `policy_rules`](#area-4--policy_rules)
- [Area 5 — Webhook event normalisation](#area-5--webhook-event-normalisation)
- [Area 6 — Action dispatch layer](#area-6--action-dispatch-layer)
- [Area 7 — Other event/automation patterns (broad scan)](#area-7--other-eventautomation-patterns-broad-scan)
- [Synthesis — extend or build new?](#synthesis--extend-or-build-new)

---

## How to read this report

Each area is structured identically:

1. **What exists** — tables, services, enums, caller counts, with `file:line` citations.
2. **Extensibility** — what it would take to extend this subsystem to support generic event-to-action routing.
3. **Coupling risk** — what existing callers or assumptions would break if the subsystem were extended.

The synthesis section at the end answers the three questions the brief requires:

- Is there a single existing subsystem that is the right foundation?
- If not, does a new subsystem belong alongside them?
- What's the minimal mapping onto the target event types (`email_reply_positive`, `form_submitted`, `crm_stage_changed`, `scheduled_trigger`, `webhook_received`, `subaccount_created`) and action types (`start_playbook`, `create_subaccount`, `send_notification`, `update_record`, `start_agent_run`)?

The report does **not** propose a schema. That decision is held until the extend-vs-build question is settled.

---

## Area 1 — `agent_triggers` + `triggerService`

*(section appended below)*

---

## Area 2 — `scheduled_tasks` + `scheduledTaskService`

*(section appended below)*

---

## Area 3 — `onboarding_bundle_configs` + `subaccountOnboardingService`

*(section appended below)*

---

## Area 4 — `policy_rules`

*(section appended below)*

---

## Area 5 — Webhook event normalisation

*(section appended below)*

---

## Area 6 — Action dispatch layer

*(section appended below)*

---

## Area 7 — Other event/automation patterns (broad scan)

*(section appended below)*

---

## Synthesis — extend or build new?

*(section appended below)*
