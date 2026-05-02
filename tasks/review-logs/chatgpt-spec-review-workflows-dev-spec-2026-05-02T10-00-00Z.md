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
| F1: Event ordering — task_sequence allocation atomicity | technical | apply | escalated (critical) | critical | Real contract gap: fan-out + multiple workers → race on sequence allocation. Spec says "extends existing per-run claim pattern" but doesn't specify atomic-allocation invariant, gap-free guarantee, or failed-write behaviour. Replay bugs under load. |
| F2: Approval/Ask gate pool refresh eligibility edge case | user-facing | apply | pending user | high | Spec explicitly says "/refresh-pool has no effect on existing reviews" for Approval but does NOT define what happens for Ask when original submitter submits after pool refresh removes them. Visible behaviour gap. |
| F3: Cost tracking source of truth | technical | apply | escalated (critical) | critical | §7.4 cites "existing cost-reservation table (architect verifies)" but doesn't pin: which table is the authoritative accumulator, what happens if the cost write fails (is the step considered free?). Pause logic depends on this. |
| F4: Pause between steps — long-running single step exceeds cap | user-facing | apply (Option A) | pending user | critical | §7.4 explicitly says pause is "between-step, not mid-step" — this is the right design, but the spec doesn't call out the consequence: a step exceeding the cap is not interruptible. Users setting a 1h cap for a 2h step will be surprised. Need an explicit "best-effort" limitation note OR heartbeat checkpoints. Recommend Option A (document limitation) to stay consistent with the spec's already-made design choice. |
| F5: Approval rejection dominance note | technical | reject | auto (reject) | medium | §5.1 already says "V1 simplification; V2 may add 'rejection requires N rejecters'". Spec already has the V2 note. Finding is redundant. |
| F6: isCritical rejection — no recovery path | user-facing | apply | pending user | medium | §5.2 says "operator's only recovery path is Stop". Spec should document intent to add a future override/resume path (consistent with the pattern used for other V1 simplifications). |
| F7: Draft lifecycle — orphan UX discoverability | user-facing | apply | pending user | medium | §10.6 ties draft re-entry to the same chat session (via the "Open in Studio" card). A user who closes the tab and navigates away has no re-entry point unless they return to that specific chat session. Discoverability gap. |
| F8: WebSocket replay — no retention policy | technical | apply | auto (apply) | medium | Genuine missing contract. Replay query `WHERE task_sequence > $lastEventId` will silently return zero rows if events are pruned before the client reconnects. Must define: retention must exceed reconnect window; client must fall back to full task reload on gap detection. |
| F9: Ask auto-fill — type-change silent corruption | user-facing | apply | pending user | medium | §11.5 + spec-time decision #10 explicitly chose "no warning on schema change, pre-fill matching keys". ChatGPT's refinement is narrower: if a key exists in both schemas but the TYPE changed (e.g., text → number), pre-filling would silently apply incompatible data. The fix (skip auto-fill for type-mismatched keys) is lightweight, does not add UX friction, and prevents silent corruption. |
| F10: Diff hunk identity drift | technical | reject | auto (reject) | medium | §12.4 already has a concurrency guard: `version_check` (`current_version == from_version + 1`) blocks revert-against-stale-base and returns `409 {base_version_changed}`. Any hunk drift caused by subsequent edits is already caught by this guard. Content hash would be defence-in-depth (YAGNI pre-production). |
| M1: Max approver pool size | technical | defer | escalated (defer) | low | Valid limit to define. Architect should pick at decomposition. Not a blocking spec gap. |
| M2: Max Ask fields per step | technical | defer | escalated (defer) | low | Valid limit to define. Architect should pick at decomposition. |
| M3: Max files per task before grouping mandatory | technical | defer | escalated (defer) | low | UI threshold. Architect to pick based on performance profiling. |
| M4: Timeout for /run/resume race window | technical | defer | escalated (defer) | low | §19 already captures open extension-cap parameters. Architect-time. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] Added event retention invariant to §8.1 — client fallback to full task reload on gap detection (F8)

---
