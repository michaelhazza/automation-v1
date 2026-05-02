# ChatGPT Spec Review Session — workflows-dev-spec — 2026-05-02T10-00-00Z

## Session Info
- Spec: docs/workflows-dev-spec.md
- Branch: claude/workflows-brainstorm-LSdMm
- PR: #252 — https://github.com/michaelhazza/automation-v1/pull/252
- Mode: manual
- Started: 2026-05-02T10:00:00Z

---

## Round 1 — 2026-05-02T10:00:00Z

### ChatGPT Feedback (raw)

Executive summary: The spec is very strong and buildable. 4 critical gaps, 6 medium risks.

🔴 Critical gaps (fix before build):
1. Event ordering contract is underspecified (task_sequence allocation under concurrency — allocation semantics, what happens on failed write after allocation)
2. Approval + Ask share gate table but lifecycle differs — /refresh-pool edge case for Ask: submitter in original pool, pool refreshed, submitter no longer in pool but submits after refresh
3. Cost tracking source of truth is ambiguous — existing cost-reservation table cited but actual cost source (event log? aggregation? reservation ledger?) not pinned; pause logic depends on exact accumulated cost; if cost write fails → step must fail, not be free
4. "Pause between steps" breaks long-running single steps — if a step runs 2h and cap = 1h, system cannot enforce cap; fix: either document as best-effort OR add heartbeat checkpoints

🟡 Medium risks (worth tightening):
5. Approval rejection dominance too blunt — single rejection trumps multiple approvals; suggest adding note it's intentional V1 and may evolve to quorum-based in V2
6. isCritical rejection has no recovery path — user accidentally rejects → entire run dead; suggest documenting future recovery path (manual resume with override)
7. Draft lifecycle can create orphan UX — draft discoverable only from same chat session; user closes tab and comes back later with no visible entry point
8. WebSocket replay assumes infinite retention — no retention policy defined; if events pruned → replay breaks; fix: event retention must exceed max session reconnect window; fallback to full task reload on gap
9. Ask auto-fill can create silent data errors — field renamed → wrong value silently applied; fix: if field key exists but type changed → do not auto-fill that field
10. Diff hunk identity may drift after edits — (from_version, hunk_index) unstable after subsequent edits; suggest content hash to validate identity before revert

🟢 Minor clarifications:
M1. Define max approver pool size (UI + performance guard)
M2. Define max Ask fields per step
M3. Define max files per task before grouping becomes mandatory
M4. Define timeout for /run/resume race window (optional)

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: Event ordering — task_sequence allocation atomicity | technical | apply | apply (user, "as recommended") | critical | Real contract gap: fan-out + multiple workers → race on sequence allocation. Spec says "extends existing per-run claim pattern" but doesn't specify atomic-allocation invariant, gap-free guarantee, or failed-write behaviour. Replay bugs under load. Escalated due to critical severity. |
| F2: Approval/Ask gate pool refresh eligibility edge case | user-facing | apply | apply (user, "as recommended") | high | Spec explicitly says "/refresh-pool has no effect on existing reviews" for Approval but does NOT define what happens for Ask when original submitter submits after pool refresh removes them. Visible behaviour gap. |
| F3: Cost tracking source of truth | technical | apply | apply (user, "as recommended") | critical | §7.4 cites "existing cost-reservation table (architect verifies)" but doesn't pin: which table is the authoritative accumulator, what happens if the cost write fails (is the step considered free?). Pause logic depends on this. Escalated due to critical severity. |
| F4: Pause between steps — long-running single step exceeds cap | user-facing | apply (Option A) | apply Option A (user, "as recommended") | critical | §7.4 explicitly says pause is "between-step, not mid-step" — this is the right design, but the spec doesn't call out the consequence: a step exceeding the cap is not interruptible. Users setting a 1h cap for a 2h step will be surprised. Option A documents the limitation; consistent with the spec's already-made design choice. |
| F5: Approval rejection dominance note | technical | reject | auto (reject) | medium | §5.1 already says "V1 simplification; V2 may add 'rejection requires N rejecters'". Spec already has the V2 note. Finding is redundant. |
| F6: isCritical rejection — no recovery path | user-facing | apply | apply (user, "as recommended") | medium | §5.2 says "operator's only recovery path is Stop". Spec now documents intent to add a future override/resume path (consistent with the pattern used for other V1 simplifications). |
| F7: Draft lifecycle — orphan UX discoverability | user-facing | apply Option A | apply Option A (user, confirmed after disambiguation) | medium | §10.6 ties draft re-entry to the same chat session (via the "Open in Studio" card). User confirmed Option A (chat session only) on disambiguation — matches brief §3.0 strategic test ("describe intent, don't build systems") and frontend-design-principles "default to hidden". A "Continue from draft" Studio surface lands in a follow-up spec if discoverability becomes a real pain point in production. |
| F8: WebSocket replay — no retention policy | technical | apply | auto (apply) | medium | Genuine missing contract. Replay query `WHERE task_sequence > $lastEventId` will silently return zero rows if events are pruned before the client reconnects. Must define: retention must exceed reconnect window; client must fall back to full task reload on gap detection. |
| F9: Ask auto-fill — type-change silent corruption | user-facing | apply | apply (user, "as recommended") | medium | §11.5 + spec-time decision #10 explicitly chose "no warning on schema change, pre-fill matching keys". ChatGPT's refinement is narrower: if a key exists in both schemas but the TYPE changed (e.g., text → number), pre-filling would silently apply incompatible data. The fix (skip auto-fill for type-mismatched keys) is lightweight, does not add UX friction, and prevents silent corruption. |
| F10: Diff hunk identity drift | technical | reject | auto (reject) | medium | §12.4 already has a concurrency guard: `version_check` (`current_version == from_version + 1`) blocks revert-against-stale-base and returns `409 {base_version_changed}`. Any hunk drift caused by subsequent edits is already caught by this guard. Content hash would be defence-in-depth (YAGNI pre-production). |
| M1: Max approver pool size | technical | defer | defer (user, "as recommended") | low | Valid limit to define. Architect should pick at decomposition. Not a blocking spec gap. Routes to tasks/todo.md. |
| M2: Max Ask fields per step | technical | defer | defer (user, "as recommended") | low | Valid limit to define. Architect should pick at decomposition. Routes to tasks/todo.md. |
| M3: Max files per task before grouping mandatory | technical | defer | defer (user, "as recommended") | low | UI threshold. Architect to pick based on performance profiling. Routes to tasks/todo.md. |
| M4: Timeout for /run/resume race window | technical | defer | defer (user, "as recommended") | low | §19 already captures open extension-cap parameters. Architect-time. Routes to tasks/todo.md. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] Added event retention invariant to §8.1 — client fallback to full task reload on gap detection (F8)
- [user] Added `task_sequence` allocation invariant to §8.1 — atomic + gap-free per task_id; failed write surfaces `event_log_corrupted` (F1)
- [user] Added Ask vs Approval pool-refresh asymmetry note to §5.1.2 — Ask submits use current snapshot, Approval keeps prior decisions (F2)
- [user] Added cost source of truth + cap-best-effort notes to §7.4 — ledger sum, failed cost-write fails the step, long steps may exceed cap (F3, F4)
- [user] Added V2 isCritical recovery path note to §5.2 — privileged manual resume with override reason (F6)
- [user] Added V1 chat-session-only discoverability note to §10.6 — no Studio "Recent drafts" surface in V1 (F7)
- [user] Amended §11.5 step 3 — pre-fill only when key AND type match; type-mismatched keys treated as new fields (F9)

### Deferred to backlog (routed at finalisation)

- M1: define max approver pool size — architect-time
- M2: define max Ask fields per step — architect-time
- M3: define max files per task before grouping mandatory — architect-time
- M4: timeout for /run/resume race window — already in §19 open items

---
