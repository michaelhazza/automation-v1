# ChatGPT PR Review Session — claude-md-updates — 2026-04-22T05:00:00Z

## Session Info
- Branch: claude-md-updates
- PR: #171 — https://github.com/michaelhazza/automation-v1/pull/171
- Started: 2026-04-22T05:00:00Z

---

## Round 1 — 2026-04-22T05:15:00Z

### ChatGPT Feedback (raw)
Executive summary: This PR is directionally solid and cleans up a real structural issue around context management. Most changes are correct and aligned with how you want sessions to behave. There is one genuine logic bug that will cause incorrect spec selection, plus a couple of smaller consistency gaps that are worth tightening now before they become workflow footguns.

🔴 Critical issue (should fix before merge)
1. Spec auto-detection can select the wrong file — tasks/current-focus.md now matches tasks/**/*.md and is not excluded; can become the sole candidate on a branch that changes it.

🟠 High-leverage improvements
2. Detection logic is still too implicit — introduce positive signal (Spec-ID marker or constrain to tasks/**/spec*.md) instead of relying only on exclusions.
3. Plan gate UX is operationally brittle — detect model at runtime or require explicit "confirm-execution" to prevent costly Opus execution.
4. Dual source of truth risk between architecture.md and CLAUDE.md — strengthen pointer language to make CLAUDE.md explicitly a non-canonical file.

🟡 Minor issues / polish
5. Knowledge index rule is correct but easy to violate — add enforcement/comment to _index.jsonl writer code path.
6. Non-goals section is strong but not enforced — add non-goals gate to spec-reviewer.
7. Historical reference migration is handled well — no change needed.

### Decisions

| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| Spec auto-detection selects tasks/current-focus.md as spec candidate | accept | critical | Genuine logic bug — file matches tasks/**/*.md and is not in the exclusion list; would run review against a pointer file |
| Introduce positive signal (Spec-ID marker or spec*.md constraint) | reject | high | YAGNI — exclusion-list approach is the established pattern; fixing the concrete failure mode (finding 1) handles the realistic case without redesigning detection |
| Plan gate: detect model at runtime or require confirm-execution | reject | high | Agents have no reliable API access to detect the caller's model; "confirm-execution" adds friction for a speculative failure mode against clearly documented instructions |
| Strengthen CLAUDE.md pointer: explicitly state it holds no canonical references | accept | medium | Clear immediate value — prevents future contributors from duplicating content in the wrong file |
| Add enforcement/comment to _index.jsonl writer path | reject | low | _index.jsonl writer lives in agent instruction prose, not application code; no code file to annotate; [missing-doc] — no documented standard for agent-prose rule enforcement exists |
| Add non-goals gate to spec-reviewer | defer | low | Valid future enhancement but out of scope for this PR; would require spec-reviewer to reason about product strategy, not just structural spec quality |
| Historical reference migration note — no change needed | n/a | low | ChatGPT confirms correct; nothing to implement |

Top themes: architecture, scope, other

### Implemented
- `.claude/agents/chatgpt-spec-review.md`: extended spec detection exclusion list to include `tasks/current-focus.md`, `tasks/todo.md`, `tasks/**/progress.md`, `tasks/**/lessons.md`
- `CLAUDE.md`: added explicit "Authoritative references live in architecture.md, not here" note under the Current focus pointer

---

## Final Summary
- Rounds: 1
- Implemented: 2 | Rejected: 4 | Deferred: 1
- Index write failures: 0 (0 = clean)
- Deferred to tasks/todo.md § PR Review deferred items / PR #171:
  - Non-goals gate for spec-reviewer — valid but out of scope; requires spec-reviewer to reason about product strategy
- Architectural items surfaced to screen (user decisions): none
- KNOWLEDGE.md updated: yes (1 entry — spec auto-detection exclusion list gotcha)
- architecture.md updated: no
- PR: #171 — ready to merge at https://github.com/michaelhazza/automation-v1/pull/171
