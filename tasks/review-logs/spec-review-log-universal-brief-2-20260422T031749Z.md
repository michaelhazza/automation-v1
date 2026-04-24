# Spec Review Log — universal-brief — Iteration 2

**Run timestamp (same as iteration 1):** `20260422T031749Z`
**Codex output:** `tasks/review-logs/_universal-brief-iter2-codex-output.txt`
**Codex prompt:** `tasks/review-logs/_universal-brief-iter2-prompt.txt`

## Findings (6 total; all mechanical)

### #2.1 — P1 — `ChatTriageInput` still Phase 3 despite iteration-1 move of `briefFastPath.ts`
- **Where:** §6.3.1 signature uses `ChatTriageInput['uiContext']`; `ChatTriageInput` is defined in §6.1 (Phase 3). Iteration 1 advanced `shared/types/briefFastPath.ts` types to Phase 2 but `ChatTriageInput` specifically lives in `chatTriageClassifierPure.ts` (Phase 3).
- **Classification:** mechanical (residual from iteration 1 #13)
- **Disposition:** auto-apply — extract a `BriefUiContext` interface into the Phase-2 `shared/types/briefFastPath.ts`; let `ChatTriageInput` in Phase 3 import it. `createBrief`'s signature uses `BriefUiContext` directly.

### #2.2 — P1 — `quality_score` column missing from `0ZZZ` SQL block
- **Where:** §5.3 migration SQL does not include `quality_score`; §5.3 prose + §14.2 schema entry + Phase 5 scope line all reference it.
- **Classification:** mechanical
- **Disposition:** auto-apply — add `quality_score numeric(3,2) NOT NULL DEFAULT 0.5` column to the ALTER TABLE block.

### #2.3 — P1 — Task/Agent-run chat panes lack defined routes/sockets
- **Where:** §8.7 (Task chat Phase 2, Agent-run chat Phase 7) reference UI surfaces for non-Brief conversations; §7 only defines Brief routes.
- **Classification:** mechanical
- **Disposition:** auto-apply — add §7.12 "Generic conversation-message endpoints" listing `POST /api/conversations/:conversationId/messages` + `GET /api/conversations/:conversationId` + socket room `conversation:${conversationId}`. Task and Agent-run panes consume these. Brief-specific routes in §7.1–7.4 remain for Brief-level operations.

### #2.4 — P2 — Shadow-eval outcome recording: sync vs async contradiction
- **Where:** §6.1 says direct `fastPathDecisionLogger.recordOutcome(...)` call; §10 says queued fire-and-forget.
- **Classification:** mechanical
- **Disposition:** auto-apply — keep the sync call-shape inside `fastPathDecisionLogger`, but note that the call is fire-and-forget via the soft-breaker pattern. The "queued / async" row in §10 is misleading — this is synchronous-best-effort at the call site, not pg-boss queued. Rewrite §10 row accordingly; keep §6.1 text verbatim.

### #2.5 — P2 — Phase 0 exit gate claims synthetic capability but §12.2 references CRM Planner
- **Where:** §11 Phase 0 exit gate "synthetic capability" vs §12.2 "Phase 0 ships one example capability (CRM Query Planner's CRM contract test — coordinated cross-branch)".
- **Classification:** mechanical
- **Disposition:** auto-apply — restrict Phase 0 to a local synthetic fixture (`server/lib/__tests__/briefContractTestHarness.example.test.ts` — Phase 0 only); move CRM Planner harness adoption to Phase 9 prose.

### #2.6 — P2 — `isAuthoritative` tier has no governance
- **Where:** §4.6 `RuleCaptureRequest` accepts `isAuthoritative?: boolean`; no permission check is named; §5.3 precedence gives authoritative rules priority over scope; §6.3.2 flow step 1 says "permission check — user must have edit on the target scope" but no authoritative-specific check.
- **Classification:** mechanical
- **Disposition:** auto-apply — add an explicit governance rule in §6.3.2: setting or clearing `is_authoritative=true` requires an **org-admin** permission on the target scope (reuses existing `requireOrgAdmin`-style check; named in `server/lib/permissions.ts`). Non-admins who POST with `isAuthoritative=true` get a 403. Document in §9.5 under permission keys and in §4.6 nullability note.

---

## Counts (for stopping heuristic)

- `mechanical_accepted`: 6
- `mechanical_rejected`: 0
- `directional_or_ambiguous`: 0
- `reclassified → directional`: 0

Iteration 2 — **mechanical-only round.**

**Stopping heuristic check:** iterations 1 and 2 are both mechanical-only (directional=0, ambiguous=0, reclassified=0). After applying iteration 2's fixes, the stopping heuristic "two consecutive mechanical-only rounds → stop" triggers. **Loop exits after iteration 2.**
