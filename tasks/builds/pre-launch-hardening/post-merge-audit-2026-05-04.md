# Pre-Launch Hardening — Post-Merge Relevance Audit

**Audited:** 2026-05-04 (after merging `origin/main` into `claude/pre-launch-hardening-spec-fs3Wy`)
**Mini-spec authored:** 2026-04-26 (8 days ago)
**Main commits absorbed:** 908 between mini-spec authoring and this audit
**Audit scope:** every item ID cited in `docs/pre-launch-hardening-mini-spec.md` × current state of `tasks/todo.md` and `docs/superpowers/specs/`

---

## Table of contents

- §0 Headline finding + per-chunk verdict
- §1 Chunk 1 — RLS Hardening Sweep
- §2 Chunk 2 — Schema Decisions + Renames
- §3 Chunk 3 — Dead-Path Completion
- §4 Chunk 4 — Maintenance Job RLS Contract
- §5 Chunk 5 — Execution-Path Correctness
- §6 Chunk 6 — Gate Hygiene Cleanup
- §7 Recommendation summary + pre-write verifications

---

## §0 Headline finding

**Roughly half of the mini-spec's items have already shipped on `main` since 2026-04-26.** Three downstream specs absorbed the work the mini-spec was about to carve up:

- **PR #196** (`codebase-audit-remediation`) — Phases 1+2+3, merged earlier.
- **PR #235** (`pre-prod-tenancy`) — merged 2026-04-29. Closed 13/15 Chunk 1 items + the three `B10` jobs' silent-no-op behaviour (Chunk 4) + parts of Chunk 6.
- **PR #247** (`deferred-items-pre-launch`) — merged 2026-05-01. Closed `DR1`, `DR2`, `DR3`, `S2-SKILL-MD`.
- **PR #211** (state-machine guards) — closed part of Chunk 5's `C4b-INVAL-RACE` at terminal-write boundaries (intermediate transitions still uncovered).

### Per-chunk verdict

| Chunk | Verdict | Action |
|---|---|---|
| 1 — RLS Hardening | **DROP** | 13/15 closed; the 2 residuals (SC-2026-04-26-1, GATES-2026-04-26-2) move to Chunk 6 |
| 2 — Schema Decisions + Renames | **KEEP** | All 12 items still open; nothing on main touched the F-items, W1-6/29, WB-1, DELEG-CANONICAL, BUNDLE-DISMISS-RLS, CACHED-CTX-DOC |
| 3 — Dead-Path Completion | **SHRINK** | DR1/DR2/DR3 all shipped; only `C4a-REVIEWED-DISP` remains. Fold into Chunk 5. |
| 4 — Maintenance Job RLS | **DROP** | Silent-no-op behaviour fixed; per-org `withOrgTx` defense-in-depth already routed to pre-prod-tenancy Phase 3 (optional) |
| 5 — Execution-Path Correctness | **KEEP (narrowed)** | 6 of 7 items still open. `C4b-INVAL-RACE` scope narrows to "intermediate non-terminal transitions" (terminal-write boundaries already covered by PR #211). Folds in `C4a-REVIEWED-DISP` from Chunk 3. |
| 6 — Gate Hygiene Cleanup | **KEEP (narrowed)** | Most items still open. Drop `S2-SKILL-MD` (closed). Take on the 2 residuals from Chunk 1. |

Result: **3 specs, not 6** — Chunk 2, narrowed Chunk 5, narrowed Chunk 6. Chunks 1, 3, 4 dissolve into either prior shipped work or the surviving three specs.
