# Dual Review Log — brief-feature-updates

**Files reviewed:**
- client/src/components/Layout.tsx
- client/src/components/global-ask-bar/GlobalAskBar.tsx
- client/src/pages/BriefDetailPage.tsx
- client/src/pages/OrgChartPage.tsx
- server/routes/briefs.ts
- server/routes/sessionMessage.ts
- server/services/__tests__/skillHandlerRegistryEquivalence.test.ts
- server/services/scopeResolutionService.ts
- shared/lib/parseContextSwitchCommand.test.ts
- shared/lib/parseContextSwitchCommand.ts

**Iterations run:** 3/3
**Timestamp:** 2026-04-29T00:53:59Z

---

## Iteration 1

Codex output: bare `--uncommitted` review with no custom prompt. After ~210s of repo exploration (git status, file reads of Layout.tsx, sessionMessage.ts, briefs.ts, scopeResolutionService.ts, BriefDetailPage.tsx) Codex returned ONE finding.

```
[ACCEPT] client/src/components/Layout.tsx:541-542 — stale subaccount override sent under new org [P2]
  Reason: Real cross-tenant data-integrity bug. When admin changes the org dropdown
  in the New Brief modal, the existing subaccount dropdown still shows the OLD
  org's subaccounts (the `subaccounts` state is keyed off `hasOrgContext`, not
  off `briefOrgOverride`). User can pick a stale subaccount; submit then sends
  X-Organisation-Id=<NewOrg> with subaccountId=<OldOrg-subaccount>. Server has no
  cross-entity check on POST /api/briefs, so the brief lands with mismatched
  org/subaccount foreign keys. Fix: hide the subaccount dropdown when orgChanged.
```

Beyond Codex, the user's brief explicitly asked me to evaluate cross-tenant escape paths in `sessionMessage.ts` Path A/B/C and to consider whether `briefs.ts POST` needs server-side defence. Inspection found:

```
[ACCEPT] server/routes/briefs.ts POST /api/briefs — missing cross-entity check (DEVELOPMENT_GUIDELINES §9)
  Reason: When subaccountId is supplied in the body (or uiContext.currentSubaccountId),
  the route passes it straight to createBrief without validating it belongs to req.orgId.
  createBrief inserts into tasks via raw db (no withOrgTx context), so RLS does not
  catch the mismatch. This is the server-side counterpart to the Layout.tsx hole
  Codex flagged; it must be closed even if the client is fixed because any client
  (including non-browser) can hit the route. Fix: call resolveSubaccount(subaccountId,
  req.orgId!) before createBrief.

[ACCEPT] server/routes/sessionMessage.ts:137 Path C — trusts client-supplied organisationId
  Reason: const organisationId = sessionContext.activeOrganisationId ?? req.orgId!
  takes the org from the request body, not the authenticated session. The
  authenticate middleware sets req.orgId from the X-Organisation-Id header
  (admin) or the user's own org (non-admin), and audits cross-org access.
  Trusting a body-supplied value bypasses the audit trail and lets any client
  set any org as the write target. Same Path C also lacks the cross-entity
  subaccount check. Fix: clamp organisationId to req.orgId, validate
  subaccountId via resolveSubaccount.
```

Items NOT accepted in iteration 1:

```
[REJECT] briefs.ts active-run query missing 'pending' / 'awaiting_clarification' statuses
  Reason: The current ['running', 'delegated', 'cancelling'] set covers the dominant
  in-flight states. 'pending' is a transient milliseconds-window before worker pickup,
  and the BriefDetailPage exponential backoff polling (500 ms → 4 s) catches up
  immediately when the run transitions. 'awaiting_clarification' / 'waiting_on_clarification'
  are paused-on-user states where the live graph would just show the same root forever —
  no value over not showing it. Polish item, not a correctness bug. The user's framing
  asks me to reject "different style" suggestions that don't materially improve
  safety/correctness — this qualifies.

[REJECT] briefCreationService uses raw db.insert without withOrgTx
  Reason: Pre-existing architectural pattern (DEVELOPMENT_GUIDELINES §1 violation),
  not introduced by this branch. Out of scope for this dual-reviewer pass on
  brief-feature-updates. Noted for future remediation.

[REJECT] BriefDetailPage polling effect stale-closure / memory-leak risks
  Reason: Polling effect at lines 175-206 already uses cancelled flag + activeRunIdRef
  + cleanup clearTimeout pattern correctly. New state-reset useEffect at lines 159-167
  is harmless interaction — clears activeRunId, which sets ref to null on next render,
  which restarts polling for the new briefId. No stale closure risk because each
  effect run captures its own `cancelled` flag and the ref is the only shared mutable
  state. Verified by walking the code.
```

### Iteration 1 changes

- Layout.tsx: hide subaccount dropdown when org override differs from active org.
- briefs.ts: add resolveSubaccount cross-entity check on POST /api/briefs.
- sessionMessage.ts Path C: clamp organisationId to req.orgId; add resolveSubaccount check on body-supplied subaccountId.

## Iteration 2

```
[ACCEPT] sessionMessage.ts:147 — resolveSubaccount returns 404 on stale subaccount, breaking valid org-only context switches [P2]
  Reason: Codex correctly identified a regression in my iteration-1 fix. After an
  org-only context switch via GlobalAskBar (admin types "switch to OrgB"), the
  client receives subaccountId=null, calls setActiveOrg(OrgB) but does NOT clear
  the localStorage activeSubaccountId (still pointing at OrgA's SubA). Next plain
  brief submission sends X-Organisation-Id=OrgB + sessionContext.activeSubaccountId=SubA.
  My new resolveSubaccount check throws 404 — user sees a generic error. Fix:
  silently drop the stale subaccount on the server (log for observability) AND
  clear activeSubaccountId on the client when an org-only context switch is
  received. Defence in depth: server is robust to any client; client gives the
  expected UX.
```

### Iteration 2 changes

- sessionMessage.ts Path C: change resolveSubaccount throw to log-and-drop; subaccountId becomes undefined on mismatch, brief gets created at org level instead of erroring.
- GlobalAskBar.tsx handleResponse: on context_switch / brief_created with new organisationId and no subaccountId, call removeActiveClient() to clear stale localStorage.

## Iteration 3

```
[ACCEPT] GlobalAskBar.tsx:38-42 — guard skips updating activeOrgId when subaccount candidate is in another org [P2]
  Reason: Codex correctly identified that for a SUBACCOUNT candidate response,
  the server returns organisationName=null (the candidateName is the subaccount
  name, not the org name), so the client's `if (data.organisationId &&
  data.organisationName)` guard fails and setActiveOrg is never called. Result:
  next request still sends old X-Organisation-Id with new subaccountId, server
  rejects subaccount as stale, brief lands in the wrong org. Fix: enrich
  resolveCandidateScope to return resolvedOrgName (parent org name from the
  subaccount join), thread it through resolveAndCreate so the server response
  carries organisationName for both org and subaccount candidates. Client guard
  then succeeds and activeOrgId updates atomically with activeSubaccountId.
```

### Iteration 3 changes

- scopeResolutionService.resolveCandidateScope: extend return type with `resolvedOrgName`, join organisations to subaccounts query, return parent org name.
- sessionMessage.ts resolveAndCreate: derive resolvedOrgName (candidateName for org, resolved.resolvedOrgName for subaccount), use it in both context_switch and brief_created responses.

---

## Changes Made

- `client/src/components/Layout.tsx` — hide subaccount dropdown in New Brief modal when org override differs from active org
- `client/src/components/global-ask-bar/GlobalAskBar.tsx` — clear stale activeSubaccountId on org-only context switch; import removeActiveClient
- `server/routes/briefs.ts` — POST /api/briefs validates body-supplied subaccountId belongs to req.orgId via resolveSubaccount
- `server/routes/sessionMessage.ts` — Path C clamps organisationId to req.orgId; subaccountId resolveSubaccount check is log-and-drop on mismatch (avoids regressing org-only context switches); resolveAndCreate threads resolvedOrgName through both context_switch and brief_created responses; new resolveSubaccount + logger imports
- `server/services/scopeResolutionService.ts` — resolveCandidateScope return type extended with resolvedOrgName; org branch selects organisations.name; subaccount branch joins organisations and returns the parent org name

## Rejected Recommendations

- **Active-run query missing pending / awaiting_clarification statuses** — polish item, not correctness; exponential backoff polling absorbs the millisecond-window gap; awaiting_clarification is a paused state where the live graph adds no value.
- **briefCreationService uses raw db.insert without withOrgTx** — pre-existing architectural debt, out of scope for this branch.
- **BriefDetailPage polling effect stale-closure / leak risks** — verified the cancelled flag + activeRunIdRef + clearTimeout pattern is correct; new state-reset useEffect interacts cleanly.

---

**Verdict:** APPROVED (3 iterations, 5 fixes applied across 5 files; all accepted Codex findings resolved in-branch)
