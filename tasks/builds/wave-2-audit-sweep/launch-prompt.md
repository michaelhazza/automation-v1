# Wave 2 Session A — audit sweep (read-only)

This session runs the 5 outstanding hotspot audits + the per-critical-path coverage matrix. Read-only — no code changes. Output is new items routed to `tasks/todo.md`.

**Paste the block below as the opening message of a fresh Claude Code session in Env A.**

---

```
Wave 2 Session A — audit sweep (read-only). Output is new items in
tasks/todo.md. Zero file-overlap risk with concurrent Sessions B and C.

audit-runner is INLINE — do NOT dispatch via the Agent tool. Read
.claude/agents/audit-runner.md and execute its playbook directly in
this session.

1. Sync and branch:
     git fetch origin main
     git checkout -b claude/wave-2-audit-sweep origin/main

2. Run 5 hotspot audits sequentially via audit-runner's inline playbook.
   For each: use Hotspot mode, findings-only (no auto-fix in this round
   — Sessions B and C are concurrently editing code; auto-fixes risk
   merge conflicts). Each audit auto-commits its log to
   tasks/audit-logs/ and routes deferred items to tasks/todo.md.

   Audit sequence:
     a. audit-runner: hotspot frontend
        Scope: 101 client pages not yet audited against
        docs/frontend-design-principles.md. Focus on the five hard
        rules. Flag pages that violate "default to hidden" or "one
        primary action per screen".
     b. audit-runner: hotspot skills
        Scope: 186 skills in the skill system vs server/lib/actionRegistry.ts
        alignment. Flag drift between declared skills and registered
        actions. Output: a matrix of skill ↔ action mappings with
        gaps highlighted.
     c. audit-runner: hotspot circular-deps
        Tool: madge --circular against server/ and client/src/.
        Output: cycle list + per-cycle root-cause hypothesis.
     d. audit-runner: hotspot duplication
        Tool: jscpd against server/ and client/src/ with sensible
        thresholds. Output: top 20 duplicate blocks ≥10 lines.
     e. audit-runner: hotspot agent-execution
        Scope: handoff audit-trail durability (Module K from the
        pre-v1-lockdown audit). Trace whether every handoff event
        is persisted to the audit log and survives a worker restart.

3. After all 5 hotspots, produce the per-critical-path coverage matrix
   (Module C from the pre-v1-lockdown audit). This is a manual
   read-only review — for each declared critical path, identify which
   tests (unit / integration / smoke) cover it and where the gaps are.
   Save the output to tasks/audit-logs/critical-path-coverage-matrix-
   <ISO>.md. Reference docs/codebase-audit-framework.md § Module C
   for the canonical format.

4. After all 6 outputs:
   - Confirm tasks/todo.md has received new items from each audit
     (audit-runner auto-routes them).
   - Tag each new item with the canonical
     [origin:audit:wave-2-<audit-name>:<ISO>] anchor so they're
     traceable.
   - Append a Wave 2 Session A summary block to tasks/todo.md
     under a new section "## Wave 2 audit sweep — 2026-05-15" with
     the audit-log file names and a one-line summary per audit.

5. Commit + push the audit logs + tasks/todo.md updates:
     git add tasks/audit-logs/ tasks/todo.md
     git commit -m "audit(wave-2): hotspot sweep + critical-path matrix"
     git push -u origin claude/wave-2-audit-sweep
   Then open a PR titled "audit(wave-2): hotspot sweep findings".
   PR body lists each audit log file + the per-audit finding count.
   DO NOT close any tasks/todo.md items in this PR — Session C
   handles closures.

6. End-of-session report (CEO-level, under 200 words):
   - Total new findings count across the 6 audits.
   - Top 3 surprise findings (things the prior audits missed).
   - Whether any finding looks like a v1 blocker (i.e., needs to
     land before lockdown rather than v2 backlog).

DO NOT modify any code outside tasks/ in this session. If an audit
suggests a high-confidence fix, route it to tasks/todo.md with
[origin:audit:wave-2-<audit-name>] — Session C will pick it up.

If audit-runner has issues running any of the 5 hotspots (missing
binary, broken script), log the blocker to tasks/todo.md under
## Blockers and skip the audit. Do NOT spend more than 30 minutes
fighting a single blocker.
```
