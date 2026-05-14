# PR Review — audit/track-rls-agent-exec (Track A: RLS + agent-execution)

**Reviewed:** server/routes/portal.ts; tasks/review-logs/codebase-audit-log-rls-agent-exec-2026-05-14T13-14-38Z.md; tasks/audit-progress-rls-agent-exec-2026-05-14T13-14-38Z.md; tasks/todo.md (audit + prevention sections); KNOWLEDGE.md (3 new entries)
**Reviewer:** pr-reviewer (independent, read-only)
**Timestamp:** 2026-05-14T13:55:00Z

Blocking: 0 / Should-fix: 2 / Consider: 3
**Verdict:** APPROVED (no blocking issues; 2 should-fix + 3 consider items recommended in-PR)

---

## 🔴 Blocking — must be fixed before merge

No blocking issues found.

The F1 mechanical fix is correct at every site. Verified independently:

- `server/middleware/auth.ts:111-143` — `req.orgId` is set from `X-Organisation-Id` header for `system_admin` (with cross-org audit logging at line 116) and from `payload.organisationId` for everyone else. Semantics-preserving for non-admins, semantics-correcting for admins.
- All 10 replaced sites (lines 46, 100, 126, 148, 184, 210, 231, 259, 295, 342) pass the value to `resolveSubaccount(subaccountId, organisationId)` — exactly the contract `DEVELOPMENT_GUIDELINES.md §1` demands.
- The previous `req.user!.organisationId` form was an active org-switching bypass: a system_admin scoped into org B via the header would have resolved subaccount-membership against their HOME org A, then immediately passed `req.params.subaccountId` (sub of B) to `automationService.listPortalAutomations` at line 53 — opening a path to mix orgs.
- The 2 remaining `verify-org-id-source.sh` violations (`auth.ts:231` logout audit log; `clientErrors.ts:72` client-render-error log) are confirmed correct as-is — both intentionally log the user's home org, not the session-switched context, for forensic correctness. The audit's "leave as baseline" call is right.

## 🟡 Should-fix — non-blocking but expected in-PR unless deferred

🟡 **R1 — `server/routes/agents.ts:36` lacks deferral comment.** F5 is deferred for product input, but the route ships unannotated. A 1–2 line comment naming the deferral and pointing at the todo costs nothing now and prevents a future reviewer from re-flagging this as a fresh finding. **APPLIED in this PR** — see commit after this log lands.

🟡 **R2 — Audit-log F8 row file-path typo.** F8 cites `server/routes/agents.ts:54-55`, but the manual-run idempotency-key code is actually at `server/routes/agentRuns.ts:54-55` (verified via Grep — `agents.ts:54-55` is the `getLinkByAgentInSubaccount` lookup, not the idempotency key fallback). The todo entry has the correct file. **APPLIED in this PR.**

## 💭 Consider — taste / future-proofing

💭 **C1 — `server/middleware/auth.ts` fallback pattern.** Four call sites inside auth.ts itself use the `req.orgId ?? req.user.organisationId` fallback. Not flagged by `verify-org-id-source.sh` and not part of Track A's surface, but the fallback pattern in the same file that defines `req.orgId` is worth a follow-up. Low priority — not introduced by this PR. **Logged as a consider; no in-PR action.**

💭 **C2 — KNOWLEDGE.md cross-links.** The three new entries could link to the related `tasks/todo.md` items for F3/F4/F7 (and P2/P4) so a future maintainer reading the KNOWLEDGE entry has a one-hop path to the open work. **Logged as a consider; not applied — minor refinement.**

💭 **C3 — Pass 2 validation N/A reasons.** All seven N/A justifications are valid for this change set; the framework's no-silent-skip clause is satisfied. **No action — confirmation only.**

## Answers to caller's specific questions

**A. portal.ts 10-site replacement correctness:** Yes — at every site `req.orgId!` is the right value. None of the 10 sites were load-bearing for "the user's home org" specifically. The two remaining `verify-org-id-source.sh` violations (auth.ts logout audit log, clientErrors.ts log enrichment) are correctly retained because they intentionally want the home org for forensic correctness.

**B. Pass 2 / Pass 3 split correctness (F5 specifically):** Right call. F5 is not "clearly a vulnerability" — `agentService.listAgents` may already filter to "agents the caller may interact with", and the product policy "every org member may list agents" is a defensible design choice. Without that product call, deferring to Pass 3 is the framework-aligned action.

**C. Severity calibration / KNOWLEDGE entries:** No overstating or understating. F4 medium/high is right. F1 medium is right. F8 low/medium is right. The three KNOWLEDGE entries are specific, file-path-bearing, and rule-prompting.

**D. Pass 2 validation table N/A reasons:** All seven N/A entries are valid.

**E. Anything else:** Two clerical items (the 🟡 above) + one architectural follow-up not in scope (the 💭 auth.ts fallback) + one KNOWLEDGE refinement. Nothing that should block merge.

## Files NOT read

- `architecture.md` — large; relied on `DEVELOPMENT_GUIDELINES.md §1` + direct verification of auth.ts/portal.ts semantics. Contract surface for this PR is fully described in `DEVELOPMENT_GUIDELINES.md §1`.
- `server/services/agentService.ts` (full) — only `listAgents`/`listAllAgents`/`listOwnedByUser` signatures verified; the F5 deferral question depends on what `listAgents` returns to non-AGENTS_EDIT callers (product call, not in scope for this audit branch).
- `server/services/agentExecutionService.ts` — Pass 3 deferred per F4; not in scope.
- `server/services/skillExecutor.ts` — Pass 3 deferred per F6/F7; not in scope.

Could unread files invalidate the verdict? No — the Pass 2 fix is localised to portal.ts and the verification surface is contained in auth.ts (read in full) + DEVELOPMENT_GUIDELINES.md §1 (read in full) + the gate output (12 → 2, deterministic).

---

Blocking: 0 / Should-fix: 2 (both applied) / Consider: 3 (logged)
**Verdict:** APPROVED — ready to open PR after should-fix items land.
