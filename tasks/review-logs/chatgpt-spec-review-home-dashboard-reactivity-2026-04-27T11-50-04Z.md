# ChatGPT Spec Review Session — home-dashboard-reactivity — 2026-04-27T11-50-04Z

## Session Info
- Spec: tasks/builds/home-dashboard-reactivity/spec.md
- Branch: create-views
- PR: #218 — https://github.com/michaelhazza/automation-v1/pull/218
- Started: 2026-04-27T11:50:04Z

---

## Round 1 — 2026-04-27T11-50-04Z

### ChatGPT Feedback (raw)

(Captured by parent session — triage already performed before this log was opened. All 16 findings recorded below.)

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| 1.1 — Activity group atomicity (`expectedTimestamp` prop on `UnifiedActivityFeed`) | technical-escalated (high severity) | apply | apply (user: as recommended) | high | Closes the only remaining within-group atomicity gap; small additive prop, no breaking change |
| 1.2 — `serverTimestamp` generation invariant (post-read, pre-serialize) | technical-escalated (high severity) | apply | apply (user: as recommended) | high | Without this rule a load-spike race produces timestamps that precede their data, silently breaking the ordering guarantee |
| 1.3 — Inflight coalescing replaces drop-if-in-flight | technical | apply | auto (apply) | medium | Coalesce-to-trailing is the standard pattern; pure drop loses freshest state in a known race window |
| 1.4 — Pre-merge `grep` check for event-coverage drift | technical | apply | auto (apply) | medium | Cheap, mechanical, prevents the exact `file-inventory-drift` finding the spec calls out |
| 1.5 — Tighten breaking API change guard (constraints + grep commands) | technical-escalated (high severity) | apply | apply (user: as recommended) | high | Five endpoints change envelope simultaneously; ambiguity about partial rollout = incident risk |
| 1.6 + Pre-loop B — `useSocketRoom` null-roomId pattern | technical-escalated (high severity, contradicts hook signature) | apply (with adjusted approach) | apply (user: as recommended) | high | Hook signature audit confirmed null-roomId early-return; old conditional-call note was wrong |
| 2.1 — `EVENT_TO_GROUP` local constant in DashboardPage | technical | apply | auto (apply) | low | Single-file guardrail, no framework, prevents drift between table and implementation |
| 2.2 — Activity group uses `min()` not `max()` for `groupTs` | technical | apply | auto (apply) | medium | `max()` lets a stale dataset slip in; `min()` is the correct atomicity primitive |
| 2.3 — Batch freshness updates via `markFresh(ts)` helper | technical | apply | auto (apply) | low | Prevents flicker on `refetchAll`; `useCallback`-stable, idempotent |
| 2.4 — Refetch failure handling (no `applyIfNewer`, no `markFresh`) | technical | apply | auto (apply) | medium | Closes "stuck but looks fresh" failure mode; indicator aging is the intended signal |
| 3.1 — ISO timestamps are UTC | technical | apply | auto (apply) | low | Cheap clarification; lexicographic comparison correctness depends on it |
| 3.2 — Event ordering: none assumed | technical | apply | auto (apply) | low | Documents an existing property of the design (`applyIfNewer` already handles any order) |
| 3.3 — Payload not trusted for UI state (global rule) | technical | apply | auto (apply) | low | Generalises a per-event note into a spec-wide invariant |
| 3.4 — `eventId` uniqueness scope | technical | apply | auto (apply) | low | Documents the global-uniqueness assumption the LRU depends on |
| Pre-loop A — Fix `emitOrgUpdate` arity (3 args, not 4) in §5.1–5.4, §11.2 | technical | apply | auto (apply) | high | Verified against `server/websocket/emitters.ts`; 5 code blocks were calling with the wrong arity |
| Pre-loop C — Fix umbrella signature note in §5 | technical | apply | auto (apply) | high | Same root cause as Pre-loop A; the note that previously said "use the 4-arg form, adjust to actual signature" is replaced with the verified 3-arg signatures |

### Applied (auto-applied technical + user-approved technical-escalated)

- [auto] §5 umbrella signature note rewritten with verified 3-arg signatures for `emitOrgUpdate` / `emitToSysadmin`
- [auto] §5.1, §5.2, §5.3, §5.4, §11.2 — 5 `emitOrgUpdate` code blocks corrected to 3-arg form
- [auto] §4.2 — added pre-merge `grep -r "emitOrgUpdate.*'dashboard\." server/` coverage check
- [auto] §4.2 — added "event ordering — none assumed" note
- [auto] §4.2 — added `EVENT_TO_GROUP` constant guardrail
- [auto] §4.3 — added "payload not trusted for UI state (global)" rule
- [auto] §4.4 — added `eventId` uniqueness scope note; rewrote idempotency description to match coalescing pattern
- [auto] §6.1 — added UTC invariant note
- [auto] §6.3 — replaced drop-if-in-flight with coalesce-via-pending-ref pattern; renamed section "(coalescing for rapid events)"
- [auto] §6.4 (new) — failure posture (no `applyIfNewer`, no `markFresh` on failure); existing §6.4 renumbered to §6.5
- [auto] §7.2 — `refetchActivity` uses `min()` for `groupTs`; aligned approval-group example with coalescing + failure handling; removed activity-group hedge
- [auto] §7.4 — added `markFresh` batched-freshness pattern
- [auto] §8.4 — references `markFresh` instead of raw `setLastUpdatedAt`
- [auto] §9.5 — initial-load freshness routes through `markFresh`
- [auto] §3.4 — added `useSocketRoom` row + clarified `useSocket` org-room auto-join
- [auto] §15 Section 8 — updated constraint→mechanism map to reflect new sections
- [user] §1.1 + §3.2 + §6.5 — `UnifiedActivityFeed` adds `expectedTimestamp?: string` prop; `refetchActivity` passes `activityTs.current` to gate the feed's internal fetch
- [user] §6.1 — `serverTimestamp` generation invariant (post-read, pre-serialize)
- [user] §6.1 — breaking change notice tightened (a/b/c/d constraints + grep commands)
- [user] §10.2 step 4 — `useSocketRoom` always called unconditionally with null-roomId gate; third-arg type corrected from array to `Record<string, handler>`; old "cannot be called conditionally" note removed

### Integrity check

Integrity check: 6 issues found this round (auto: 6, escalated: 0).

- §9.5 referenced raw `setLastUpdatedAt` after §7.4 introduced `markFresh` → fixed to reference `markFresh`
- §3.4 listed `useSocket` only; §10.2 now uses `useSocketRoom` → added row
- §4.4 still described "drop duplicate triggers" → rewritten to describe coalescing
- §6.3 section title updated from "in-flight guard" to "coalescing for rapid events"
- §15 Section 8 cross-refs updated to new section numbers and named mechanisms
- §7.2 approval-group example updated to match §6.3 + §6.4 patterns

Post-integrity sanity (4c): all heading references resolve; no section left empty; §6.4 cross-refs from §7.2, §7.4, §8.4 all reference the renumbered section correctly.

### Top themes

Three structural themes drove this round: (1) **server-emitter signature truth** — the spec's umbrella signature note was wrong and propagated to 6 code blocks; (2) **freshness correctness** — the in-flight handling, failure path, and freshness-batching together close a class of "looks fresh but isn't" failure modes; (3) **breaking-change discipline** — the five-endpoint envelope change needed explicit constraints to prevent partial rollout / dual-format ambiguity.

---
