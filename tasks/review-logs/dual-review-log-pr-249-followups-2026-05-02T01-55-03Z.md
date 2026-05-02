# Dual Review Log — pr-249-followups

**Files reviewed:** branch `pr-249-followups` vs `main`, 37 files (+494 / -18). Footprint: `client/src/components/Layout.tsx` + ~11 other client files (eslint-disable hygiene), ~20 server/worker files (mostly comment-only `// reason:` justifications and one-line `Record<string, unknown>` tightenings), 1 spec doc, 1 KNOWLEDGE.md entry, 1 review log.
**Iterations run:** 1/3
**Timestamp:** 2026-05-02T01:55:03Z
**Codex CLI:** `codex-cli 0.118.0` (auth: ChatGPT)
**Branch HEAD (at review time):** `c1365951`
**Codex command:** `codex review --base main` (working tree clean — all changes committed; uncommitted-mode would yield empty diff)
**Commit at finish:** `af6e7daa` (this log only — no source edits applied)

---

## Iteration 1

### Codex output (verbatim)

> The new badge surfaces an unsound live-agent counter that is updated without verifying the active subaccount, so users can see incorrect counts during subaccount switches. The rest of the patch is largely comment-only cleanup.
>
> Review comment:
>
> - [P2] Filter live badge updates by the current subaccount — `client/src/components/Layout.tsx:853-854`
>   Displaying `liveAgentCount` here makes an existing state bug user-visible: the `useSocketRoom` handlers in `Layout` increment/decrement this counter for every `live:agent_*` event without checking that the event still belongs to the current `activeClientId`. If a user switches subaccounts while events from the previous room are still in flight, the sidebar can briefly show a ghost live count on the wrong subaccount until the next REST resync. Please gate the badge on subaccount-scoped events (for example by carrying `subaccountId` in the payload and comparing it against a ref of the current `activeClientId`) before surfacing the count in the nav.

### Adjudication

```
[REJECT-AS-ALREADY-DEFERRED] client/src/components/Layout.tsx:853-854 — Filter live badge updates by current subaccount
  Reason: Substantive correctness concern, but already known and already deferred to operator triage. This is the same issue captured under THREE existing channels:
    1. Spec §4.4 "Concurrency invariant: scope events by activeClientId" — explicitly named in the spec at docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md:142-151. Three checkboxes; two satisfied (initial fetch and reconnect resync close over the latest activeClientId), one not (the socket handlers at Layout.tsx:431-432 unconditionally increment/decrement without payload inspection).
    2. spec-conformance log REQ #7 — already routed to tasks/todo.md:2312 as a directional gap, with full call-to-action: "read activeClientId from a ref or latest closure at event-handling time and ignore events whose payload subaccount differs."
    3. pr-reviewer log strong finding S-1 — same root pattern (initial-fetch race in the broader sibling fetches at Layout.tsx:397, :407-410, :447-453, :459-467; no cleanup-cancel; A→B→A responses can overwrite current-subaccount state). Recommended to fix together with REQ #7.

  Why not auto-apply: the fix is non-trivial. It requires (a) ensuring backend `live:agent_*` event payloads carry `subaccountId` (may already; needs verification across the emitter side, not just consumer side), (b) refactoring the two handlers at Layout.tsx:431-432 to read `activeClientId` from a ref (current closure semantics would still capture the stale value), (c) extending `useSocketRoom`'s callback shape to accept a payload arg the handlers can inspect, AND (d) optionally hardening the sibling fetches per S-1 (cleanup-cancel via AbortController on the useEffect). This is not a mechanical comment fix — it's a defence-in-depth correctness change with cross-layer impact. Per agent contract, substantive concerns that overlap an already-deferred item are acknowledged, not auto-applied. Operator already has the full context in tasks/todo.md REQ #7.
```

### Termination check

- Codex produced 1 finding total, 0 accepted, 1 acknowledged-as-already-deferred.
- Per agent contract: "If zero findings were accepted this iteration → break (Codex is raising items Claude has judged not worth fixing; further iterations will not converge)."
- Loop exits after iteration 1.

---

## Changes Made

None. No files edited. No commit produced.

## Rejected Recommendations

| ID | File:line | Codex severity | Disposition | Reason |
|----|-----------|----------------|-------------|--------|
| 1 | `client/src/components/Layout.tsx:853-854` | P2 | Acknowledged-as-already-deferred | Same issue as spec §4.4 / spec-conformance REQ #7 (`tasks/todo.md:2312`) / pr-reviewer S-1. Substantive multi-layer fix; not auto-applicable; operator already has full triage context. |

### Findings classification (per caller's requested format)

- **Implemented:** 0
- **Acknowledged-as-already-deferred:** 1 (the [P2] subaccount-filtering finding above)
- **Deferred-new:** 0 (Codex did not surface anything not already in the operator's triage queue)
- **Rejected-as-incorrect:** 0

---

**Verdict:** APPROVED (1 iteration, 0 fixes applied, 1 finding overlapped existing operator-known deferred item REQ #7)
