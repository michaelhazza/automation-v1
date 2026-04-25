# Audit Remediation — Implementation Plan

**Build slug:** `audit-remediation`
**Source spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`
**Branch base:** every chunk branches off `main`
**Branch strategy:** one PR per spec phase (Phases 1–4 each one PR; Phase 5A §8.1 is two PRs in sequence; Phase 5A §8.2 is one PR; Phase 5B items are individual PRs in any order).
**Execution model:** strict phase ordering — Chunk N+1 does not begin until Chunk N's ship gate is green on `main` (per spec §2.1). Phase 5B (Chunk 8) may begin once Chunk 4 (Phase 4) ships, independent of Phase 5A.

**Total chunks:** 8

---

## Contents

- [Chunk table](#chunk-table)
- [Chunk 1 — Phase 1: RLS hardening](#chunk-1--phase-1-rls-hardening)
- [Chunk 2 — Phase 2: Gate compliance](#chunk-2--phase-2-gate-compliance)
- [Chunk 3 — Phase 3: Architectural integrity](#chunk-3--phase-3-architectural-integrity)
- [Chunk 4 — Phase 4: System consistency](#chunk-4--phase-4-system-consistency)
- [Chunk 5 — Phase 5A PR 1: Rate limiter shadow mode](#chunk-5--phase-5a-pr-1-rate-limiter-shadow-mode)
- [Chunk 6 — Phase 5A PR 2: Rate limiter authoritative flip](#chunk-6--phase-5a-pr-2-rate-limiter-authoritative-flip)
- [Chunk 7 — Phase 5A §8.2: Silent-failure path closure](#chunk-7--phase-5a-82-silent-failure-path-closure)
- [Chunk 8 — Phase 5B: Optional backlog](#chunk-8--phase-5b-optional-backlog)
- [Cross-chunk dependencies](#cross-chunk-dependencies)
- [Executor notes](#executor-notes)

---

## Chunk table

| # | Name (kebab-case) | Spec section(s) | PR boundary | Est. files (create + modify) | Primary gate(s) |
|---|---|---|---|---|---|
| 1 | `phase-1-rls-hardening` | §4.1 – §4.6 (1A → 1E) | One PR | 7 create, ~22 modify | `verify-rls-coverage`, `verify-rls-contract-compliance`, `verify-rls-session-var-canon`, `verify-org-scoped-writes`, `verify-subaccount-resolution` |
| 2 | `phase-2-gate-compliance` | §5.1 – §5.8 | One PR | 0 create, ~9 modify | `verify-action-call-allowlist`, `verify-canonical-read-interface`, `verify-no-direct-adapter-calls`, `verify-principal-context-propagation`, `verify-skill-read-paths`, `verify-canonical-dictionary` |
| 3 | `phase-3-architectural-integrity` | §6.1 – §6.3 | One PR | 3 create, ~13 modify | `madge --circular` server ≤ 5 / client ≤ 1 |
| 4 | `phase-4-system-consistency` | §7.1 – §7.4 | One PR (§7.3 may split) | 0 create, ~10 modify | `npm run skills:verify-visibility`, `node scripts/verify-integration-reference.mjs`, `npm install` |
| 5 | `phase-5a-rate-limiter-shadow-mode` | §8.1 (PR 1) | One PR | 4 create, ~9 modify | `npm run build:server`; structured-log divergence emission; in-memory limiter remains authoritative |
| 6 | `phase-5a-rate-limiter-authoritative-flip` | §8.1 (PR 2) | One PR | 0 create, ~8 modify | `npm run build:server`; PR-1 divergence-log evidence referenced; `rateLimitBucketCleanupJob` registered |
| 7 | `phase-5a-silent-failure-path-closure` | §8.2 | One PR | 0 create, ~variable modify (per gate output) | `verify-no-silent-failures` returns clean (no WARNING) |
| 8 | `phase-5b-optional-backlog` | §8.3, §8.4 | Multiple PRs (one per item) | per item; up to 4 create + ~12 modify | `npm run build:server`; per-item local gate/test |

---

## Chunk 1 — Phase 1: RLS hardening

## Chunk 2 — Phase 2: Gate compliance

## Chunk 3 — Phase 3: Architectural integrity

## Chunk 4 — Phase 4: System consistency

## Chunk 5 — Phase 5A PR 1: Rate limiter shadow mode

## Chunk 6 — Phase 5A PR 2: Rate limiter authoritative flip

## Chunk 7 — Phase 5A §8.2: Silent-failure path closure

## Chunk 8 — Phase 5B: Optional backlog

## Cross-chunk dependencies

## Executor notes
