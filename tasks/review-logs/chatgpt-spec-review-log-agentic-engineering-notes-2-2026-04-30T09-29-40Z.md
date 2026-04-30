# ChatGPT Spec Review Session — agentic-engineering-notes — Round 2 — 2026-04-30T09-29-40Z

## Session Info
- Spec: `docs/agentic-engineering-notes-dev-spec.md`
- Branch: `claude/agentic-engineering-notes-WL2of`
- PR: #243 — https://github.com/michaelhazza/automation-v1/pull/243
- Mode: manual
- Started (Round 2): 2026-04-30T09-29-40Z
- Round 1 log: `tasks/review-logs/chatgpt-spec-review-agentic-engineering-notes-2026-04-30T09-14-16Z.md`

---

## Round 2 — 2026-04-30T09-29-40Z

### ChatGPT Feedback (raw)

```
Round 2 review

Spec is structurally tight. Round 1 fixes landed cleanly. The remaining issues are second-order: invariants that haven't been spelled out yet but will quietly cause friction once the agent is used in anger. None block build. All four are small.

F1. Idempotency invariant for adversarial-reviewer
The spec defines what the agent does, not what happens when it runs twice on the same diff. Today, two runs against an unchanged diff would produce two separate logs with potentially differently-worded findings — the dashboard sees both, the user can't tell if anything changed. Add an invariant: a second run against an unchanged diff produces identical findings (or a documented "no-op, already reviewed" log). Implementation is non-trivial — fingerprinting findings, parsing the prior log, comparing — so this might be a defer. But the invariant should be stated so future implementations honour it.

F2. Snapshot timing for detection inputs
§ 4.2 says "auto-detection logic as spec-conformance (committed + staged + unstaged + untracked)" but doesn't say when the snapshot is taken. If the agent re-polls git state mid-run, findings can reference files that have been edited or removed between the read and the report. Add one line: detection inputs are sampled once at invocation start; the agent does not re-poll git state during the review pass. Mechanical, low cost.

F3. Verdict semantics
The verdict enum is defined (NO_HOLES_FOUND | HOLES_FOUND | NEEDS_DISCUSSION) but the boundaries between the three are implicit. When does worth-confirming-only become HOLES_FOUND? When does ambiguous become NEEDS_DISCUSSION versus a soft HOLES_FOUND? The agent will need to decide, and without semantics the decision drifts. Add a short block defining each:

NO_HOLES_FOUND — full checklist run, no findings of any severity.
HOLES_FOUND — at least one confirmed-hole or likely-hole. worth-confirming-only counts if the agent is meaningfully suspicious; pure curiosity items don't.
NEEDS_DISCUSSION — diff is ambiguous enough that the agent can't decide between the above without user input. Reserved for genuine uncertainty.

F4. Log header schema (gitHeadSha, filesChanged)
Adversarial-review logs would benefit from a self-contained Session Info header capturing gitHeadSha and filesChanged, so the log is reproducible later without consulting git history. Right now the spec defines what the log contains (findings) but not what makes it self-contained. Two simple fields would solve it.

Recommendation: finalise.
F2 and F3 are cheap and high-leverage — apply both. F1 and F4 can defer if the cost-benefit doesn't land. After this round the spec is ready for build.
```

### Initial triage (first pass)

| Finding | Triage | Initial recommendation | Rationale |
|---------|--------|------------------------|-----------|
| F1 — Idempotency invariant | technical (escalated — defer) | defer | Implementation cost (fingerprint + prior-log parse + compare) too high for Phase 1 manual non-blocking. Idempotency naturally re-emerges with the F5 cross-agent schema work — wait until then. |
| F2 — Snapshot timing clarifier | technical | reject | "Detection inputs sampled once at invocation start" felt implicit from existing § 4.2 wording — the agent reads git state once into its context window. Risk seemed theoretical. |
| F3 — Verdict semantics | technical | apply | Real ambiguity. Without semantics the agent will drift on edge cases (worth-confirming-only, ambiguous diffs). ChatGPT's proposed wording is concise and agent-facing. |
| F4 — Log header schema | technical (escalated — cross-agent scope) | defer | Asymmetry vs other review logs (none of the seven existing producers emit `gitHeadSha`/`filesChanged`). Mission Control parser has no read-side consumer. Bundle with F5. |

### User pushback

User asked: "can we do more than only applying 1?"

Re-evaluation triggered. The pushback is correct — F2 was rejected on a soft "feels implicit" reading, but the snapshot-timing invariant has near-zero implementation cost (one line) and meaningful clarifying value for future maintainers / the agent itself when deciding whether to re-poll on long-running diffs. Reclassify F2 as `apply` with the narrowed wording the user supplied.

F1 and F4 stay deferred — the implementation cost / cross-agent scope arguments hold.

### Final triage (after re-evaluation)

| Finding | Triage | Final decision | Severity | Rationale |
|---------|--------|----------------|----------|-----------|
| F1 — Idempotency invariant | technical (escalated — defer) | defer | medium | Fingerprint + prior-log parsing + comparison is too much machinery for Phase 1 manual non-blocking. Bundle with R1-F5 cross-agent log-schema work — idempotency falls out naturally if `findings[]` carries fingerprints. |
| F2 — Snapshot timing clarifier | technical | apply (narrowed) | low | One-line invariant: "Detection inputs are sampled once at invocation start; the agent does not re-poll git state during the review pass." Removes ambiguity for free. User-narrowed wording adopted verbatim. |
| F3 — Verdict semantics | technical | apply | medium | Boundaries between `NO_HOLES_FOUND` / `HOLES_FOUND` / `NEEDS_DISCUSSION` are otherwise implicit; the agent will drift. ChatGPT's proposed wording inserted next to the verdict enum line. |
| F4 — Log header schema | technical (escalated — cross-agent scope) | defer | low | Asymmetry — adding `gitHeadSha`/`filesChanged` to only `adversarial-reviewer` recreates the schema drift R1-F5 is meant to prevent. Mission Control parser has no read-side consumer. Bundle with R1-F5. |

User adjudication: "go with recommended now."

### Applied (auto-applied technical + user-approved)

- [user] **F2 — Snapshot timing clarifier** in `docs/agentic-engineering-notes-dev-spec.md` § 4.2, line 113. Appended to the existing "**Input:**" sentence: "Detection inputs (committed + staged + unstaged + untracked) are sampled once at invocation start; the agent does not re-poll git state during the review pass."
- [user] **F3 — Verdict semantics block** in `docs/agentic-engineering-notes-dev-spec.md` § 4.2, lines 134–138. New `**Verdict semantics:**` paragraph + 3-bullet list inserted directly under the existing verdict enum line (line 132). Boundaries defined for `NO_HOLES_FOUND`, `HOLES_FOUND`, `NEEDS_DISCUSSION` per ChatGPT's proposed wording.

### Deferred

- **F1 — Idempotency invariant for adversarial-reviewer** → routed to `tasks/todo.md` § Spec Review deferred items › agentic-engineering-notes (2026-04-30) under the "Round 2 additions" subheading, bundled with the existing R1-F5 entry. Trigger: revisit when auto-invocation lands or when the cross-agent log-schema work is picked up. Home: `tasks/review-logs/README.md` (idempotency is naturally expressed via the `findings[]` fingerprint field once the canonical schema is designed).
- **F4 — Log header schema fields (`gitHeadSha`, `filesChanged`)** → routed to `tasks/todo.md` § Spec Review deferred items › agentic-engineering-notes (2026-04-30) under the "Round 2 additions" subheading, bundled with R1-F5. Trigger: revisit when the cross-agent log-schema work is picked up. Home: `tasks/review-logs/README.md` (header schema must be designed once across all seven agents to avoid the asymmetry that prompted the defer).

### Rejected

- None this round.

### Files modified this round

- `docs/agentic-engineering-notes-dev-spec.md` — § 4.2 line 113 (F2 appended one sentence to existing Input paragraph); § 4.2 lines 134–138 (F3 added Verdict semantics paragraph + 3-bullet block under verdict enum line).
- `tasks/todo.md` — extended the existing `### agentic-engineering-notes (2026-04-30)` block under `## Spec Review deferred items` with a "Round 2 additions" subheading containing two new sub-items (R2-F1 idempotency, R2-F4 log header schema). Did NOT create a new top-level entry.

### Integrity check

Post-edit pass over `docs/agentic-engineering-notes-dev-spec.md`:

- No broken forward references introduced — F2 inline addition is a continuation of an existing sentence; F3 block sits under the existing verdict enum line and references the same three enum values.
- No contradictions — F2 wording aligns with the existing "auto-detection logic as `spec-conformance`" sentence; F3 verdict semantics align with the verdict enum already defined two lines above.
- No missing inputs/outputs — both edits are pure additive prose, no new contracts introduced.
- Markdown structure clean: no orphaned headings, no broken table rows, no unmatched code fences. The new bullet list under "**Verdict semantics:**" is well-formed.

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

### Round 2 totals

- Auto-accepted (technical): 0 applied, 0 rejected, 0 deferred. (All findings escalated due to defer recommendation or user-adjudicated.)
- User-decided (user-facing + technical-escalated): 2 applied (F2, F3), 0 rejected, 2 deferred (F1, F4).

---

(Awaiting user signal: another round of ChatGPT feedback, or finalise. ChatGPT explicitly closed Round 2 with "Recommendation: finalise.")
