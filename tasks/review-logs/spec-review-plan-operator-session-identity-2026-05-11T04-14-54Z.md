# Spec Review Plan — operator-session-identity

**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Spec status:** untracked (new draft); not yet committed.
**Spec-context hash:** 267433f2 (last_reviewed_at 2026-05-10; 1 day old; GREEN under staleness gate)
**Iteration cap:** 5 (lifetime)
**Starting iteration:** 1

## Pre-loop context check

- Spec framing claims (§4): pre-production, rapid evolution, commit_and_revert, static gates primary, pure-function tests only — **match spec-context.md exactly.**
- No mismatch detected; proceed with iteration 1.

## Stopping heuristics
- Two consecutive mechanical-only rounds → stop.
- Codex empty + rubric empty → stop.
- Zero-acceptance for two rounds → stop.

## Brief vs spec scope check
- Brief is locked v4 (operator-session credential broker primitive).
- Spec adds operator-authorised scope expansion: /connections CRUD consolidation (§5). Operator confirmed in invocation.
- This is in scope for review.
