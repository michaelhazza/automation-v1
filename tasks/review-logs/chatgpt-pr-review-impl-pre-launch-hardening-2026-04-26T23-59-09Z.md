# ChatGPT PR Review Session — impl-pre-launch-hardening — 2026-04-26T23-59-09Z

## Session Info
- Branch: `impl/pre-launch-hardening`
- PR: #211 — https://github.com/michaelhazza/automation-v1/pull/211
- Started: 2026-04-26T23:59:09Z
- Prior reviews: `pr-reviewer` then `dual-reviewer` (3 iters, 13 fixes accepted) — see `tasks/review-logs/dual-review-log-pre-launch-hardening-2026-04-26T23-46-19Z.md`
- Round 1 commit: `2a74291d` (pushed to `origin/impl/pre-launch-hardening`)

---

## Round 1 — 2026-04-26T23:59:09Z

### ChatGPT Feedback (raw)

```
Executive summary

This is a large, well-structured hardening PR with strong consistency across specs, invariants, and implementation. The direction is correct and aligns with a production-grade system. The main risks are silent contract drift (UI ↔ backend), RLS posture exceptions scaling unintentionally, and complexity creep in invariants vs enforcement. Nothing here blocks merge, but a few areas should be tightened before locking it in.

What's strong (keep as-is)
1. Spec ↔ implementation alignment (clear traceability spec → invariant → test → code path)
2. Idempotency + decision handling model
3. RLS discipline (with explicit exceptions)
4. Test coverage philosophy (pure tests, contract-focused tests)

Key risks / gaps to address

1. UI ↔ backend contract drift (approval flow)
   In BriefDetailPage.tsx: optimistic append decisionArtefact locally + also rely on WS events for reconciliation. Risk: duplicate artefacts, ordering inconsistencies, temporary divergence. Fix: enforce one source of truth — either optimistic + idempotent dedupe on artefactId, or pure WS reconciliation. Right now hybrid without a hard guard.

2. Option B-lite RLS posture (cached context)
   Service-layer filtering is now the only enforcement for subaccount isolation. Future engineers will forget to apply filters. Mandatory fix: a single shared guard function for all reads (e.g. assertSubaccountScopedRead(query, subaccountId)) + a grep/CI gate that fails if cached-context tables are queried without that guard. Right now the policy is documented, but not enforced mechanically.

3. Invariants vs enforceability gap
   Some invariants are philosophical or multi-step to verify; will silently degrade. Tighten: every invariant must map to at least one of CI gate, unit test, or runtime assertion. If any invariant is "manual only", it will rot.

4. Jobs allow-list pattern
   Allow-list approach is correct, but over time becomes a dumping ground for exceptions. Add constraint: each allow-list entry must include justification comment (you already do this) AND a linked invariant or spec section ID. Prevents "just add it to the list" later.

5. Error contract split (skills)
   v1: flat string error. Future: structured envelope. Risk: consumers depend on both formats; migration painful. Recommendation: add a normalisation layer now — always expose errorCode + errorMessage even if internally flat. Avoids breaking change later.

6. State machine integrity (runs / steps)
   Strong invariants but no visible runtime enforcement that invalid transitions are impossible. Add: centralised assertValidTransition(from, to), used everywhere (not optional).

7. Large PR risk (operational)
   ~10k lines, 125 files. Risk: hidden regressions, hard rollback surface. Recommendation: feature flags OR deploy in shadow mode for critical paths.

Smaller observations (positive)
- Good catch on (organisation_id, user_id, doc_set_hash) uniqueness.
- Naming consistency across specs is strong.
- "Non-goals" section in capabilities is clean and useful.

Final verdict: Ready to merge with minor tightening. If only three to fix: (1) approval-artefact dedup, (2) Option B-lite mechanical enforcement, (3) invariant→enforcement mapping completeness.
```

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | Approval artefact: optimistic append + WS append both unconditional, no `artefactId` dedup → real duplicate-render bug in `BriefDetailPage.tsx` | technical | implement | auto (implement) | medium | Confirmed real defect by reading `client/src/pages/BriefDetailPage.tsx:99-119, 160-167` — both `brief-artefact:new` and `brief-artefact:updated` blindly spread `[...prev, art]`. Trivial dedup-by-`artefactId` fix; user-experience side is invisible (today: occasional duplicate card; after fix: one card). Internal correctness only — not a UX/copy/workflow change. |
| F2 | Option B-lite mechanical enforcement: shared `assertSubaccountScopedRead` helper + CI gate banning cached-context reads without it | technical-escalated (architectural) | defer | user-approved (defer) | medium | Valid concern. Contradiction-check: spec § 8.7 (`docs/cached-context-infrastructure-spec.md`) explicitly names service-layer filters as the **chosen authority** and Option B-lite as a first-class permanent decision. Adding the guard is not wrong, but it is a new primitive (`DEVELOPMENT_GUIDELINES.md § 8.4`: prefer existing primitives, justify new ones) and a new CI gate that touches every cached-context call site (`referenceDocumentService`, `documentBundleService`, `bundleResolutionService`). scope_signal=architectural → escalated per agent rules. |
| F3 | Every invariant must map to at least one CI gate / test / runtime assertion | technical | reject | auto (reject) | low | Already implemented. `docs/pre-launch-hardening-invariants.md` lines 12-20 explicitly require an `*Enforcement:*` block on every invariant. A grep of the file shows every numbered invariant carries one. The recommendation describes a state the document already enforces. |
| F4 | Allow-list discipline: each entry must cite linked invariant or spec section ID, not just rationale | technical | implement | auto (implement) | low | Cheap doc-only change to `scripts/rls-not-applicable-allowlist.txt` header. File is currently empty, so this is a pre-emptive format rule that prevents the "dumping ground" failure mode ChatGPT flags. Aligns with `DEVELOPMENT_GUIDELINES.md § 6.3` ("System-scoped tables must document … why they are not added to RLS_PROTECTED_TABLES"). |
| F5 | Skill error envelope normalisation layer (always expose `errorCode` + `errorMessage` even when internally flat) | technical | reject | auto (reject) | low | Direct contradiction of locked architectural decision. `docs/pre-launch-hardening-spec.md` § 4.3 + line 2060 lock Branch A (grandfather flat-string `error: <code-string>`) per the cross-spec consistency sweep v1. Invariant 2.4 records "100% adherence to Branch A" as the done-criterion — adding a normalisation layer is partial-Branch-B and reintroduces the mixed-shape problem the invariant exists to prevent. |
| F6 | Centralised `assertValidTransition(from, to)` runtime guard for run / step state machine | technical-escalated (architectural) | defer | user-approved (defer) | medium | Valid in principle. Contradiction-check: invariants 6.1–6.5 already pin transition rules and select static-grep + pure-test enforcement (`docs/pre-launch-hardening-invariants.md` lines 247-285). Adding a runtime assertion is a new primitive used by every status-write site across `workflowEngineService`, `agentExecutionService`, `decideApproval`, etc. — meaningful blast radius. scope_signal=architectural → escalated per agent rules. |
| F7 | Feature flags OR shadow-mode deploy for critical paths to mitigate large-PR rollback surface | technical | reject | auto (reject) | medium | Direct contradiction of locked spec rule. `docs/pre-launch-hardening-invariants.md` § 5.2: "No feature flags. Rollout model is `commit_and_revert` (`docs/spec-context.md:36`). … `feature_flags: only_for_behaviour_modes` … not pre-launch hardening." `convention_rejections` mapping (spec-context.md:73) explicitly rejects this class of finding. |
| F8 | Smaller observations — positive notes on dismissals uniqueness, naming, non-goals | n/a | n/a | no-op | n/a | Praise only; no action required. |

### Auto-applied this round (pending user gate for F2 / F6)

- [auto] F1: dedup-by-`artefactId` in `BriefDetailPage.tsx` for both WS handlers and the optimistic POST-success path.
- [auto] F4: append "format rules" paragraph to `scripts/rls-not-applicable-allowlist.txt` requiring each new entry to cite a linked invariant or spec section ID.

### User decisions

User reply: `all as recommended` — **defer F2 and F6** (both routed to `tasks/todo.md` for follow-up specs).

- F2 (Option B-lite mechanical enforcement): **deferred** — to be specced post-launch when a concrete cross-subaccount data-leak trigger is observed (per spec § 8.7).
- F6 (`assertValidTransition` runtime guard): **deferred** — to be specced as a dedicated lifecycle-guard spec that defines the transition tables and picks the failure mode (throw vs log vs metric).

### Round 1 summary

| Outcome | Count | Items |
|---------|-------|-------|
| Auto-implemented | 2 | F1, F4 |
| Auto-rejected | 3 | F3, F5, F7 |
| User-approved (defer) | 2 | F2, F6 |
| No-op (praise) | 1 | F8 |
| **Total findings** | **8** | |

### Files changed this round

- `client/src/pages/BriefDetailPage.tsx` — F1 dedup-by-`artefactId`
- `scripts/rls-not-applicable-allowlist.txt` — F4 format-rules header
- `tasks/todo.md` — F2 + F6 deferred-item routing
- `tasks/review-logs/chatgpt-pr-review-impl-pre-launch-hardening-2026-04-26T23-59-09Z.md` — this log

### Verdict

**Round 1 complete.** Two implements applied, three rejects auto-decided against locked architectural decisions, two defers user-approved and routed for future specs. PR ready for next ChatGPT iteration if more feedback exists; otherwise PR is mergeable per the original ChatGPT verdict ("Ready to merge with minor tightening").

