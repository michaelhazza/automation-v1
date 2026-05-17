# Wave 3 Session F — capabilities registry backfill (doc-only)

Single coordinated PR. Doc-only. Runs AFTER Wave 2 + Wave 3 Session E merges.

**Paste the block below as the opening message of a fresh Claude Code session in Env F.**

---

```
Wave 3 Session F — capabilities registry backfill (doc-only).
Single coordinated PR. ~60 items, all editing docs/capabilities.md
and corresponding tasks/todo.md entries.

PREREQUISITE: Wave 2 Sessions A-D and Wave 3 Session E must be merged
to main before launching this session. Doc-only so file-overlap risk
with concurrent code sessions is zero, but tasks/todo.md is shared
state — sequence after E.

1. Sync and branch:
     git fetch origin main
     git checkout -b claude/wave-3-capabilities-backfill origin/main

2. Items to apply. Two categories, each ~30 items:

   === OWNER-RESOLUTION (lines 414-790 in tasks/todo.md) ===
   30 sections of the form:
     ### owner-resolution: <capability-id>
     Capability ID: <capability-id>
     Unknown field: <field-name>
     Current value: TBD ...
     Notes: ...

   For each, look at the capability's row in docs/capabilities.md
   (use grep with the capability-id). Resolve the unknown field:
     - "Owner team" → name the team responsible (platform, ai-agent,
       backend, frontend, growth, etc.). Use docs/teams.md if it
       exists; otherwise default to "platform" for backend/infra,
       "ai-agent" for skill/agent/llm, "frontend" for UI/UX, "growth"
       for SEO/email/marketing.
     - "Review cadence" → on-incident-only, quarterly, monthly, or
       bi-annual. Default: on-incident-only for Mature, quarterly for
       Active.
     - "Lifecycle state" → if not stated, default to Mature for
       capabilities that have shipped and are in production use,
       Active for capabilities under iteration, Experimental for
       capabilities behind feature flags.

   Update docs/capabilities.md in-place. Mark each owner-resolution
   item in tasks/todo.md as [status:closed:pr:<this-PR-num>].

   === CAPABILITIES-BACKFILL (lines 798-1175 in tasks/todo.md) ===
   30 sections of the form:
     ### capabilities-backfill: <capability-id>
     Capability ID: <capability-id>
     Unknown field: Carry notes
     Current value: TBD — see tasks/todo.md#capabilities-backfill-...
     Due date: 2026-08-14
     Notes: Research and fill in carry notes ...

   For each, author Carry notes for the capability in
   docs/capabilities.md. Carry notes describe ongoing maintenance,
   review cadence, operational cost — see docs/capabilities.md
   § Lifecycle Declaration for the canonical format.

   Default template per capability if no domain knowledge surfaces:
     "Ongoing maintenance: <brief description>. Review cadence: <from
     owner-resolution above>. Operational cost: <low/medium/high based
     on traffic / LLM cost / infra footprint>."

   Update docs/capabilities.md in-place. Mark each capabilities-backfill
   item in tasks/todo.md as [status:closed:pr:<this-PR-num>].

3. Verification per item:
   - For each updated capability row in docs/capabilities.md, run
     scripts/verify-capabilities-format.sh (if exists) OR a manual
     grep to confirm the row matches the canonical shape.
   - Markdown must parse (no broken tables, no unclosed code fences).
     The long-doc-guard hook will block oversized writes; use Edit
     append, not full-file Write.
   - Confirm vendor-neutral phrasing per Editorial Rules. Specific
     vendor names (e.g., OpenAI, Anthropic, GitHub) are only acceptable
     where the capability is bound to a specific provider — otherwise
     use generic terms.

4. Final checks:
   - npm run lint (catches doc style if hooked)
   - Manual diff review of docs/capabilities.md — ~60 sections changed.
   - tasks/todo.md status updates for all 60 items.

5. Open PR titled "wave-3: capabilities registry backfill (Session F)".
   Body lists the 60 capabilities updated with one-line summary.
   DO NOT close items via PR body keywords — operator confirms before
   merge.

6. End-of-session report (CEO-level, under 200 words):
   - Total capabilities updated.
   - Any capability where Owner team / Review cadence / Lifecycle state
     was non-obvious (operator should confirm before merge).
   - Any capability where the Carry notes felt thin — flag for follow-up.

DO NOT modify any capability rows that already have complete data.
DO NOT introduce new capability rows in this PR.
DO NOT touch code outside docs/ and tasks/todo.md.

Estimated effort: 4-6 hours of mechanical doc work.
```
