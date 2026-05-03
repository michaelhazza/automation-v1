# Workflows V1 — Build Progress

Branch: `feature/workflows-v1` · Worktree: `.worktrees/workflows-v1-impl/`

## Chunks status

- [x] **Chunk 1** — Schema migration + RLS (in commit `c9b65945`)
- [x] **Chunk 2** — Engine validator (in commit `c9b65945`)
- [x] **Chunk 3** — Per-task event log (in commit `c9b65945`)
- [x] **Chunk 4** — Gate primitive + state machine (in commit `c9b65945`)
- [x] **Chunk 5** — Approval routing + isCritical (in commit `c9b65945`)
- [x] **Chunk 6** — Confidence + audit (in commit `c9b65945`)
- [x] **Chunk 7** — Cost / wall-clock runaway protection (in commits `c9b65945` + `de6b34e3` review-cycle fixes)
- [ ] **Chunk 8** — Stall-and-notify + schedule pinning (in progress)
- [ ] **Chunk 9** — Real-time WebSocket coordination
- [ ] **Chunk 10** — Permissions API + Teams CRUD
- [ ] **Chunk 11** — Open task view UI
- [ ] **Chunk 12** — Ask form runtime
- [ ] **Chunk 13** — Files tab + diff renderer
- [ ] **Chunk 14a** — Studio canvas + publish
- [ ] **Chunk 14b** — Inspectors + draft hydration
- [ ] **Chunk 15** — Orchestrator changes
- [ ] **Chunk 16** — Naming cleanup + cleanup job

## Review cadence per chunk

1. Implementer (Sonnet) — implements + tests + typecheck/lint clean
2. Spec reviewer (Sonnet) — verifies code matches plan + invariants
3. Implementer fix (Sonnet) — addresses spec findings if any
4. Quality reviewer (`pr-reviewer` agent) — independent code-quality review
5. Implementer fix (Sonnet) — addresses quality findings if any
6. Commit + push as separate commit
7. Update this progress.md

## Outstanding deferred items (carried across chunks)

See `tasks/todo.md` § *Deferred from Chunk 7 spec review (workflows-v1) — 2026-05-03*:

- Wall-clock heartbeat 60s vs spec 30s — pg-boss cron minimum 1m; mitigated by between-step check
- `params.onFail = 'continue' | 'gate'` propagation logged but not wired
- Pre-step cost-cap on parallel multi-step dispatch (V2)
- Skill-executor idempotency-header audit
- Vitest port for `workflowRunPauseStopServicePure.test.ts`
- `decideRunNextState.currentStatus` fate (wire `'already_terminal'` short-circuit or drop)
- `STEP_COST_ESTIMATE_CENTS` alias audit (`agent`/`agent_call`, `action`/`action_call`)
