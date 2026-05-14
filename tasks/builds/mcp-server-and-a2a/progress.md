# MCP server publishing + A2A inbound — build session

**Slug:** `mcp-server-and-a2a`
**Branch:** `claude/mcp-server-a2a-brief-Uyodh`
**Status:** DEFERRED — placeholder session, not active.
**Earliest revisit:** ~2-3 months from 2026-05-14 (post product launch + stability work).
**Brief:** [`tasks/research-briefs/mcp-server-and-a2a-dev-brief.md`](../../research-briefs/mcp-server-and-a2a-dev-brief.md)

## Why this session exists

The brief is a 2-3 engineer-week PoC, not a public launch. It is intentionally deferred until after Synthetos launch and stability work. This directory exists so the work has a known home when we pick it up — no engineering effort is committed yet.

## When picking this back up

Run the brief's revisit checklist (§ Revisit checklist at top of `mcp-server-and-a2a-dev-brief.md`) before anything else:

- Confirm Synthetos has launched and `docs/spec-context.md` posture has flipped.
- Re-check MCP spec status (current target: 2025-11-25; newer may be live).
- Re-check peer agent platforms for shipped MCP inbound (Make, n8n, Zapier, Tray, Mindstudio).
- Re-check published incident reports (Asana / Atlassian / GitHub class).
- Confirm A2A v1.x has accumulated named multi-tenant production references (or has not — in which case A2A remains deferred).

Then: invoke `spec-coordinator` against the brief to produce `spec.md`, followed by `architect` for `plan.md`.

## Scope reminder (from brief)

- 2-3 engineer weeks, time-boxed.
- Read-only MCP server, 5-10 system skills.
- Internal-staff-only, `mcp-poc.synthetos.com`.
- Not a public launch; decisional PoC answering three architectural questions (§7 of brief).
- A2A inbound: deferred, no PoC.

## Files in this session

- `progress.md` (this file) — session pointer.
- `spec.md` — produced when work begins (`spec-coordinator`).
- `plan.md` — produced after spec gate (`architect`).
- `handoff.md` — produced at Phase 2 → Phase 3 handoff.

## Decisions deferred to the dev session

See §6 of the brief (Open questions for the dev session). The big ones:

1. Authorization server: external SaaS (Stytch / Auth0 / Descope / WorkOS) vs in-house.
2. Deployment target: Cloudflare Workers vs Synthetos own infra.
3. Token-claim shape: standard OAuth scopes vs custom Synthetos claims (recommended: hybrid).
4. Operator visibility surface for MCP host activity.

## Log

- **2026-05-14.** Session directory created as a placeholder. No engineering work started. Brief lives at `tasks/research-briefs/mcp-server-and-a2a-dev-brief.md`.
