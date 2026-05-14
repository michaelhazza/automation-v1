# Progress — phase-1-showcase-mvps

## 2026-05-10 session — Phase 2 BUILD close

**Outcome:** Phase 2 complete. Branch-level review pass closed cleanly. Status: REVIEWING. Ready for `launch finalisation`.

**What this session did:**
1. Detected state mismatch: `current-focus.md` pointed to `support-desk-canonical`, but the active branch was `feat/phase-1-showcase-mvps` with chunks 1-10 already built across 17 prior commits and no handoff.
2. Pointed `current-focus.md` at the right build.
3. Ran the branch-level review pass that had never been executed for this branch:
   - spec-conformance NON_CONFORMANT (16 deferred items, 7 H/P blockers).
   - Closed 7 high-priority blockers (REQ #4, #5, #27, #36, #40, #41, #49, #52). Re-ran spec-conformance → CONFORMANT_AFTER_FIXES.
   - pr-reviewer round 1: CHANGES_REQUESTED (5 P0 + 7 strong). Closed 5 P0 + 3 spec-correctness strongs (S1, S2, S6). 4 strongs + 7 non-blocking deferred to backlog.
   - pr-reviewer round 2: caught 1 regression (missing `SET LOCAL ROLE admin_role` in `verifyRunBelongsToOrg`) + 1 SAVEPOINT placement strong. Both fixed.
   - pr-reviewer round 3: APPROVED.
   - adversarial-reviewer: HOLES_FOUND (1 confirmed hole — supportEvalHarness bare-db, 1 likely XSS via inline mimeType, 3 worth-confirming, 3 observations). All 8 closed in-branch.
   - dual-reviewer (Codex 3/3 iterations): 7 findings, 5 ACCEPT and fixed, 2 rejected with rationale. APPROVED.
4. Wrote handoff.md, updated current-focus.md.

**Decisions made:**
- Two corrective migrations rather than mutating shipped 0314/0315: 0316 swaps default skill list to spec; 0317 aligns 0315's RLS policy with canonical IS NOT NULL guards.
- supportEvalHarness moved to `getOrgScopedDb` (works for both job and route entry paths).
- phase1RunTraceEventEmitter uses SAVEPOINT-wrapped inserts inside the caller's open org-scoped tx for best-effort durability without poisoning the outer tx.
- Internal finalize route enforces tenant-isolation cross-check via `withAdminConnection` + `SET LOCAL ROLE admin_role`, plus MIME-type allowlist + 10MB size cap.
- Two-layer XSS defence at write (allowlist) and read (inline disposition restricted to safe MIME prefixes).
- S6 (escalation skill calls) deferred — implementing `support.add_internal_note` + `support.assign(human)` requires new skill handlers; the loop-pending warn-log signal is the temporary marker.
- support-agent-run job producer deferred — REQ #40 in `tasks/todo.md`; out of surgical-fix scope.

**Open at handoff:** none for Phase 2. Phase 3's finalisation-coordinator will run S2 sync + G4 regression guard + chatgpt-pr-review + doc-sync sweep + KNOWLEDGE.md pattern extraction + ready-to-merge label.
