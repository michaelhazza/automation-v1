# ADR-0003: Workspace identity uses canonical pattern, one workspace per subaccount

**Status:** accepted
**Date:** 2026-04-29
**Domain:** workspace identity / agent infrastructure
**Supersedes:** —
**Superseded by:** —

## Context

The "agents are real employees with their own Gmail / 365 / native identity" feature needs a data model for workspace identities (email, calendar, documents, etc.). Two design questions:

1. **Provider-agnostic vs per-provider tables?** Same question CRM faced; CRM chose canonical.
2. **Identity tenancy: per-org, per-subaccount, or per-agent?**

The wrong choice compounds: agents and humans must share an identity space (otherwise inter-entity collaboration breaks across tables); inter-agent collaboration must work (otherwise agents can't email each other).

## Decision

**Provider-agnostic, mirroring CRM canonical pattern.**

Schema:
- `canonical_workspace_identities`
- `canonical_messages`
- `canonical_calendar_events`
- `canonical_documents`
- `connector_configs.connector_type` extended to include `google_workspace | microsoft_365 | synthetos_native`
- Per-provider adapters under `server/adapters/`
- Provenance tracked via the `connector_config_id` FK edge — not duplicated columns

Both `agents.workspace_identity_id` and `users.workspace_identity_id` point at the **same** `canonical_workspace_identities` table. Agents and humans share one identity space.

**Tenancy: workspace is per-subaccount, NOT per-agent.**

Constraint: `(organisationId, subaccountId, connector_type)` unique. This deliberately diverges from the CRM's org-level `(organisationId, connector_type)` constraint.

Rationale:
- Per-agent is overkill — a company's identity domain is single-tenant within the company.
- Inter-agent collaboration breaks if every agent has a different workspace.
- Mirrors the one-CRM-per-company logic operators already understand.

**Rollout: native first, Google second.**

`synthetos_native` ships first to avoid being blocked by Google/Microsoft API integration. Google adapter (service-account + domain-wide delegation) is the launch wedge against Gemini Enterprise's "agent uses the human's permissions" model. Microsoft 365 follows.

## Consequences

- **Positive:**
  - Agents and humans appear as peers in the same identity space — `From: agent@company.com` and `From: alice@company.com` route through the same plumbing.
  - Provider-agnostic schema means swapping Gmail → Outlook is a connector swap, not a data migration.
  - Per-subaccount tenancy matches operators' mental model (each client/subaccount has its own provider connection).
  - Native-first ships before Google API blockers can land.
- **Negative:**
  - Diverges from CRM's `(organisationId, connector_type)` constraint — operators familiar with one pattern have to learn the other.
  - Three providers to support increases per-feature surface area (mailbox-send, calendar-create, etc. needs three implementations).
- **Neutral:**
  - `synthetos_native` is the default for agents until a real provider is connected — adds a "fake provider" pathway the team has to maintain.

## Alternatives considered

- **Per-agent identities.** Rejected — inter-agent collaboration breaks; operators don't think this way.
- **Per-org identities (mirror CRM exactly).** Rejected — multi-tenant SaaS clients each have their own identity domain; org-level is too coarse.
- **Provider-specific tables (no canonical layer).** Rejected — same trap CRM avoided; every cross-provider feature would need conditional logic.
- **Skip native, ship Google first.** Rejected — Google API approval timeline is unpredictable; native ships immediately and demos the agent-as-employee positioning without external dependencies.

## When to revisit

- If a fourth provider category emerges (e.g. Slack-as-workspace, Notion-as-workspace), the `connector_type` enum may need to split into `messaging_provider` / `productivity_provider` / etc.
- If a customer onboards multiple Google Workspace tenants per subaccount (currently unsupported by the unique constraint), the constraint shape needs revisiting.
- If `synthetos_native` becomes a permanent fixture (not a stepping stone), the "fake provider" code paths need an honest review for production-readiness.

## References

- KNOWLEDGE.md entry: `### [2026-04-29] Decision — Workspace identity uses canonical pattern (mirrors CRM), one workspace per subaccount`
- Schema: `server/db/schema/canonicalWorkspace*.ts`
- Adapters: `server/adapters/<provider>WorkspaceAdapter.ts`
- Spec: see `docs/agent-coworker-features-spec.md` and related agent-as-employee docs
