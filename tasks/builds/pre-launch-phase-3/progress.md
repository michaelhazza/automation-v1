# Build Progress — pre-launch-phase-3

**Build slug:** `pre-launch-phase-3`
**Branch:** `claude/pre-launch-phase-3`
**Spec:** `tasks/builds/pre-launch-phase-3/spec.md` (locked + approved)
**Handoff:** `tasks/builds/pre-launch-phase-3/handoff.md` (written)

## Phase 1 — SPEC

| Step | Status | Notes |
|------|--------|-------|
| 0. Context load + PLANNING lock | DONE | `tasks/current-focus.md` parallel block added (alongside baseline-capture REVIEWING) |
| 2. Branch-sync S0 + freshness | DONE | Branched from main HEAD `a7ad66fc`; 0 commits behind |
| 3. Brief intake + UI-touch detect | DONE | UI-touch = no (hardening / observability / CI invariants); mockup loop skipped |
| 4. Build slug derivation + dir | DONE | `pre-launch-phase-3` directory created |
| 5. Mockup loop | SKIPPED | No UI surface |
| 6. Spec authoring | DONE | 498 lines; 24 source items closed across 5 chunks (A-E) + 4 explicit verdicts |
| 7. spec-reviewer (Codex) | DONE | 3/5 iterations used; READY_FOR_BUILD; 3 mechanical findings auto-applied (B.3 gate, D.5 idempotency, D.5 ON CONFLICT predicate); 0 directional; 1 ambiguous routed to todo.md (Mission Control parser — outside spec scope) |
| 8. chatgpt-spec-review (manual) | DONE | 5 rounds; APPROVED FINAL (commit `35179a4f`); 33 technical findings auto-applied; 1 auto-rejected (`AppError version: 1` YAGNI); 2 escalated-to-defer (Phase 4 raw-DB-writes gate; post-launch failure playbook); 6 KNOWLEDGE entries added |
| 9. Handoff write | DONE 2026-05-05 | `tasks/builds/pre-launch-phase-3/handoff.md` written via chunked workflow (long-doc-guard); decisions log + deferrals + open questions captured |
| 10. current-focus → BUILDING | DONE 2026-05-05 | parallel mission-control block flipped PLANNING → BUILDING; prose body kept in sync per the prose-canonical rule |

## Source items (Phase 3 backlog)

Three Phase 2 deferral streams + spec-deviations + adversarial residue:

- chatgpt-pr-review Round 1 (4): R1-4, R1-6, R1-7, R1-8
- chatgpt-pr-review Round 2 (3): R2-2, R2-3, R2-6
- chatgpt-pr-review Round 3 (3): R3-1, R3-2, R3-6
- adversarial-reviewer Phase 2 (6): AR-3.1, AR-5.1, AR-1.1, AR-2.2, AR-4.1, AR-6.1
- spec-conformance Phase 2 deviations (3): REQ #4, REQ #15, REQ #29
- adversarial-reviewer Phase 1 residue (4): migration header, signup-RL email-bucket, GHL enrol cap, withOrgTx pattern refactor
- chatgpt-pr-review Phase 1 round 2 deferral (1): agent-triggered GHL OAuth resume wiring

Total = 24 items.

## Decisions made in Phase 1

Canonical record lives in `tasks/builds/pre-launch-phase-3/handoff.md § 4` (Decisions made in Phase 1 — architecture / framing). Highlights:

- Single canonical typed-error class (`AppError` with `readonly` + `Object.freeze` immutability); legacy throws normalised in `asyncHandler` — no Phase 3 backfill.
- Audit-event factory IS the union — `auditEvent` const-object factory with `typeof`-derived `SecurityAuditEventName`; no raw-string source; cast-bypass blocked by B.4 grep gate.
- Severity bound at factory entry (closed enum, not call-site).
- `NormalisedEmail` branded type as canonical RL key constructor; B.3 grep gate scoped to cast-bypass detection only.
- GHL pagination: single-writer per connection (`singletonKey: ghl-enrol:${connectionId}`, cursor in payload).
- `runId` chain identity — monotonic within a chain, globally unique across chains, `crypto.randomUUID()` only.
- Three-state event taxonomy: `enrolCompleted`/`enrolFailed` terminal, `enrolPartial` non-terminal checkpoint (page-cap = safety abort, not failure).
- Post-terminal silence invariant — no events of any kind after a chain closes; runtime check at handler.
- Cursor trust boundary — `pageCursor` opaque; safety nets (empty-page early exit + page-cap abort) handle invalid/stale/looping cursors.
- Per-location idempotency on partial-unique index `(organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`.
- Soft-delete interaction — tombstoned rows free `(org, external_id)` for re-insert (intentional; future hard-lock is a separate spec).
- Connection-token assertions emit-then-throw — security-boundary failures observable in `security_audit_events` independent of error-log routing.
- AppError post-construction immutability + audit log append-only (corrections via `context.supersedes`).
- Rate-limit fail-open posture — auth-availability over abuse-resistance during incidents; emits `BACKEND_UNAVAILABLE` audit event.
- CI gate failure posture meta-rule — fail-fast `exit 1` + single-line actionable error.
- LRU dedupe full SHA-256 (256 bits), process-bound + best-effort.

Operator-confirmed deferrals: Phase 4 raw-DB-writes gate (co-located with R3-2 backfill); post-launch OAuth-enrol + connection-token failure runbooks (waits on first-agency monitoring).

