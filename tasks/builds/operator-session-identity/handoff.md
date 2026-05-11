# Handoff — operator-session-identity

**Phase complete:** SPEC
**Phase status:** PHASE_1_COMPLETE
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md
**Branch:** claude/evolve-session-identity-brief-17LO4
**Build slug:** operator-session-identity
**UI-touching:** yes
**Mockup paths:** prototypes/operator-session-identity/ (22 screens — index.html through 20-sign-in-again-light.html)
**Spec-reviewer iterations used:** 5 / 5 (cap reached; 54 mechanical findings applied; 0 directional items; 0 routed to tasks/todo.md)
**ChatGPT spec review log:** REVIEW_GAP — chatgpt-spec-review agent not registered in this environment's fleet. The spec-reviewer's 5 iterations (54 mechanical fixes) serve as the primary review pass. Operator should run a manual ChatGPT-web review against the spec before launching feature-coordinator if risk profile warrants it.
**Open questions for Phase 2:** See spec §18 (6 open questions). Key items:
  1. Default subscription storage — is_default boolean column on integration_connections (spec assumes this) vs FK on subaccounts. Builder must pick in Chunk 1.
  2. Disclosure version bump detection — on-read (spec picks this) vs background sweep job.
  3. Provider connection mechanism verification — registry currently `none_verified`. Builder activates when mechanism confirmed; no spec change needed.
  4. Agent allowlist JSONB collision risk with existing config_json — builder should audit config_json field usage before writing to it.
  5. Re-auth identity mismatch detection — server-side check not fully specified in spec; builder should define before Chunk 7.
  6. Disclosure version bump scope — per-subaccount consent confirmed (not org-level umbrella).

**Decisions made in Phase 1:**
- Scope class: Major
- UI-touching: yes — 13 mockup rounds, 22 screens, prototypes at prototypes/operator-session-identity/
- Vocabulary palette locked (see spec §6): Connect/Sign in again/Disconnect/Turn off agent use/Make default/Edit availability/Transfer ownership; 6 usability_state pill labels
- Build slug: operator-session-identity (matches brief)
- Scope amendment: /connections CRUD consolidation refactor absorbed (§5) — CredentialsTab.tsx and IntegrationsAndCredentialsPage.tsx deprecated
- Three-tab /connections structure: App Integrations (card grid) / Web Logins (table) / AI Subscriptions (table)
- Default storage pattern: is_default boolean column on integration_connections (open question for builder to confirm)
- Failover policy (locked): Default first → alphabetical order → platform fallback
- Confirmation patterns: type-to-confirm (Disconnect only) / typed phrase "I accept the risk" (first-time Plus) / checkbox re-ack (repeated consent)
- Disclosure version bump: on-read detection (§11.4 Option A)
- Agent allowlist storage: JSONB in config_json on integration_connections
- Per-agent Model Access section on agent edit pages: read-only policy summary (Standard runs locked to platform; Autonomous runs show allowed subscriptions)
- BYO API keys: parked — not in scope
- MCP server and Cookie auth types: schema-level only, no user-facing UI
- Provider capability registry: TypeScript const in server/config/operatorSessionProviders.ts; V1 openai entry with connectionMechanism: none_verified
- spec-reviewer ran 5/5 iterations; 54 mechanical fixes applied; REVIEW_GAP on chatgpt-spec-review

**Review log:** tasks/review-logs/spec-review-final-operator-session-identity-2026-05-11T05-04-12Z.md

---

## Previous pause record (cleared)

Phase was paused after mockup round 4 (2026-05-11) — recovered and completed in same session.

---

## How to launch Phase 2

Open a new Claude Code session and type:

```
launch feature coordinator
```

The feature-coordinator reads this handoff file and begins Phase 2 (BUILD). It will invoke `architect` to break the spec into an implementation plan, then run builders per chunk (Chunks 1-11).
