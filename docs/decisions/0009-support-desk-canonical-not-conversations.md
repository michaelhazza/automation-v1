# ADR-0009: Support tickets use dedicated canonical tables, not `canonical_conversations`

**Status:** accepted
**Date:** 2026-05-10
**Domain:** support desk, data model

## Context

The `support-desk-canonical` build (spec `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`, brief §4 + §10 #7) needed to decide where support tickets and their message threads should live in the canonical data model.

Two alternatives were on the table before the spec was locked: route tickets through the existing `canonical_conversations` table (generic conversation scaffold already used by chat-first agent interactions), or introduce dedicated tables (`canonical_tickets`, `canonical_ticket_messages`, etc.). The spec-authoring session and three rounds of `chatgpt-spec-review` (log: `tasks/review-logs/chatgpt-spec-review-support-desk-canonical-2026-05-09T08-14-57Z.md`) converged on dedicated tables. The brief's §3 (canonical-first pattern) and §10 #7 (shape mismatch argument) were the primary inputs.

## Decision

We will store support tickets in five dedicated canonical tables (`canonical_inboxes`, `canonical_support_agents`, `canonical_tickets`, `canonical_ticket_messages`, `canonical_ticket_drafts`) rather than routing them through `canonical_conversations`.

These tables carry all support-specific fields that the generic conversation shape cannot express: `priority`, `assignee` (FK to `canonical_support_agents`), `canonical_inbox_id`, `sla_breach_at`, `tags`, `internal_note` flag on messages, `status` with a support-specific state machine (open / pending / solved / closed / spam / quarantine), and a structured draft lifecycle with three-phase dispatch. The deduplication key is `(organisation_id, provider_type, external_id)` — consistent with the canonical-data pattern shared by contacts and companies.

`canonical_conversations` remains the home for agent-interaction threads (chat, brief, task, agent_run scopes). The boundary comment in the `conversations` table schema enforces the rule: conversations are transport only; domain logic must not depend on conversation structure.

## Consequences

- **Positive:**
  - Support-specific fields (`priority`, `assignee`, `inbox`, `SLA`, `internal_note`, `tags`) are first-class columns rather than JSONB blobs or tag workarounds.
  - The status state machine maps cleanly to provider statuses with a fail-closed `quarantine` sentinel for unknowns.
  - The draft lifecycle (three-phase dispatch invariant) is expressible without polluting the generic conversation write path.
  - RLS policies scope cleanly by `organisation_id` with no multi-scope ambiguity.
  - Canonical deduplication key `(organisation_id, provider_type, external_id)` is consistent across all canonical entity types.
- **Negative:**
  - A new family of tables must be maintained — migrations, RLS policies, service layer, adapter wiring, and UI pages.
  - Cross-domain queries (e.g. "find all interactions with this customer across support and CRM") require a JOIN across canonical tables rather than a single conversation lookup.
- **Neutral:**
  - The `canonical_ticket_messages` table uses the polymorphic-FK split pattern (see KNOWLEDGE.md [2026-05-09]) to handle the `author_type` discriminator — no native Postgres conditional FK support.
  - `source_draft_id` on `canonical_ticket_messages` uses the deferred-FK migration pattern (see KNOWLEDGE.md [2026-05-09]) — column added without inline FK in migration 0310; FK + partial index added in migration 0311 after the drafts table exists.

**OQ-1 deferral (operator-acknowledged risk):** Foundry-trained model wiring into the three-phase dispatch path is deferred. Future Foundry integration is gated on operator-driven OQ-1 close per `tasks/todo.md § Deferred from feature-coordinator hard-gate override`. Until OQ-1 closes, the dispatch path calls the Teamwork adapter directly; no LLM-model-specific routing is in place. This is the R1 mitigation recorded in the feature-coordinator hard-gate override commit `358f5ef8`.

## Alternatives considered

- **Tickets through `canonical_conversations`** — rejected. The generic conversation shape lacks the field surface that support tickets require: no priority, no assignee FK, no inbox grouping, no SLA timestamp, no internal-note distinction on messages, and no support-specific status state machine. Encoding these as JSONB or tags would make queries fragile and RLS enforcement harder. The boundary invariant on `canonical_conversations` ("transport only; no domain logic") would also be violated by the draft-dispatch lifecycle. See brief §4 + §10 #7.
- **Per-provider tables (e.g. `teamwork_tickets`)** — rejected. This contradicts the canonical-first pattern (brief §3): canonical tables allow provider-agnostic skills, a single read path, and a uniform deduplication scheme. Per-provider tables would require every skill, route, and UI page to fan out across providers as new ones are added. The canonical layer absorbs provider specifics at the adapter boundary, leaving the service layer and UI clean.

## When to revisit

- When a second helpdesk provider (Zendesk, Freshdesk, Intercom) is onboarded — validate that the canonical schema covers its field surface or extend with an additive migration.
- When OQ-1 closes — wire Foundry-trained model dispatch into `supportDraftDispatchService.ts` per the deferred spec note.
- When a cross-domain "customer history" query becomes a performance bottleneck — evaluate a materialised view joining `canonical_tickets`, `canonical_ticket_messages`, and `canonical_contacts`.

## References

- Spec: `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` §4, §10 #7, §18
- Plan: `tasks/builds/support-desk-canonical/plan.md`
- ChatGPT spec review log: `tasks/review-logs/chatgpt-spec-review-support-desk-canonical-2026-05-09T08-14-57Z.md`
- Architecture: `architecture.md § Canonical Support Desk`
- OQ-1 override commit: `358f5ef8`
