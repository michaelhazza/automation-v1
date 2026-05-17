# Brief — Task Preview mode + workspace snapshot rollback

**Status:** DRAFT v1 (2026-05-17) — operator-captured from external repo analysis
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `task-preview-mode`
**Class:** Significant (UI-touching; mockup round required before spec authoring)
**Source pattern:** [Hmbown/DeepSeek-TUI](https://github.com/Hmbown/DeepSeek-TUI) (MIT, two patterns lifted; per-step approval mode explicitly rejected)

## Problem

Operators creating a new task today have two choices: run it now, or schedule it. There is no third option to see what the agent WILL do before committing. This matters most for:

1. **Recurring tasks at creation.** An operator scheduling a daily lead-enrichment task wants to verify the agent's plan is sensible before subjecting their account to that plan running every morning.
2. **High-stakes one-shots.** "Send the Q3 brief to all 250 contacts in this segment" deserves a preview, even when individual skills like `send_email` have their own approval gates.
3. **Trust onboarding.** Operators new to the platform want to see the agent's reasoning before letting it run. Today we have no graceful surface for this; they hover the run button and hope.

Separately, when our agents make workspace edits (page updates, content drafts, file changes), the operator has no clean undo if the agent does something wrong. The skill-level approval gates handle high-stakes mutations; everyday edits land directly with no rollback path.

DeepSeek-TUI ships a three-mode operator model (Plan / Agent / YOLO) and side-git snapshot rollback. The full three-mode model is wrong for SMB operators (per-step approval undermines automation), but the Plan-mode pattern and the snapshot pattern are directly portable.

## Goal

Add two capabilities, both opt-in / invisible-by-default:

1. **Preview before running** — a new option at task creation that returns a readable execution plan WITHOUT committing actions. Operator reviews, then promotes to a real run.
2. **Workspace snapshots** — before any agent mutation of an artifact (page, content draft, file, record), capture a snapshot. Operator can undo the agent's last action on any record. Invisible by default; surfaces as an "undo last agent action" affordance on the affected record.

The default end-to-end execution model is unchanged. Existing skill-level approval gates (`publish_post`, `send_email`) continue to handle high-stakes mid-run pauses.

## Proposed approach (for the architect to evaluate)

### Capability 1: Preview mode

#### Task creation surface

The task creation flow gains a "Preview before running" option. Mockup round will determine:
- Where the option lives (radio at task creation, button next to Run, modal step)
- Whether it is per-task or settable as a default per workflow / per skill
- How Preview output is displayed (timeline, step list, plain-English summary, JSON dump)
- How "promote Preview to real Run" works (single button on the Preview result, or recreate-as-real-task)

#### Backend execution

In Preview mode, the agent runs through its normal planning + skill dispatch path but EVERY skill call is intercepted. Skills do NOT execute their side effects. Instead, each intercepted call records:
- Skill name + parameters
- What it WOULD do (skill provides a "describe" hook returning plain English)
- Any read-only data it consulted to make the decision

Final output: a readable plan the operator reviews.

#### Skill contract extension

Every skill that performs side effects gains a `describe(params) → string` hook returning plain English describing what the skill would do. Read-only skills (`web_search`, `read_workspace`) execute normally in Preview mode; only side-effect skills are intercepted.

### Capability 2: Workspace snapshots

#### Snapshot trigger

Any agent skill that mutates a tenant-owned record (page, content draft, file, contact, custom object) snapshots the BEFORE state into a snapshot table immediately before the mutation. Snapshot includes: record type, record ID, full serialised before-state, agent_run_id, skill_name, timestamp.

#### Snapshot retention

Snapshots retained for 30 days by default (architect / operator confirm range during spec). Per-tenant configurable. Snapshots count against tenant storage quota (transparent on usage views).

#### Undo affordance

Every record that has a recent agent-touched snapshot gains an "undo last agent action" control in the record detail view. Click → restore the snapshot → emit an audit log entry. If the record has been mutated by a human after the agent touched it, the undo is disabled with a tooltip explaining why (avoids overwriting the human's later edit).

#### Out of scope for snapshots

- Multi-step undo (only the most recent agent action)
- Cross-record undo (undo applies per record, not per agent run)
- Snapshots of READS (only mutations snapshot)

### Capability 3: What we explicitly do NOT build

- **No per-step approval mode.** DeepSeek-TUI's Agent mode (approval prompt before each tool execution) is wrong for SMB operators running many tasks in parallel. The existing skill-level approval gates (`publish_post`, `send_email`, future high-stakes skills) handle the legitimate human-in-the-loop need.
- **No "YOLO" mode UX.** YOLO is just today's default; no UX change to expose it.

## Constraints / non-goals

- **DO NOT** change the default execution model. Tasks still run end-to-end unless the operator explicitly picks Preview.
- **DO NOT** intercept skill calls in normal Run mode. Preview is the only path that intercepts.
- **DO NOT** retrofit a `describe()` hook onto every skill in V1. Architect prioritises which skills get it first (the side-effect skills used by the top 10 workflows is a reasonable starting cut).
- **DO NOT** snapshot every read or every internal state change. Mutations of tenant-owned records only.
- **DO NOT** ship snapshots without quota visibility. Tenants must see what snapshots are costing them in the usage view.

## Files in scope (architect locks at spec authoring; mockup round runs first)

- Mockup: `prototypes/task-preview-mode/` (multi-screen — task creation, Preview output, promote-to-run, undo affordance)
- Client: task creation page (add Preview option), Preview result view (new), record detail views (undo affordance)
- Server: new service `server/services/taskPreviewService.ts` (intercept + describe orchestration)
- Server: new service `server/services/workspaceSnapshotService.ts` (snapshot capture + restore + retention)
- Schema: new `task_previews` table (Preview run records), new `workspace_snapshots` table (record-level snapshots)
- Skill contract: extend skill frontmatter to declare side-effect status and (optionally) a `describe` template
- Skills: add `describe` hooks to the top side-effect skills (architect picks the priority list)
- Tests: Preview interception correctness (pure), snapshot capture + restore (pure), undo-disabled-on-later-human-edit logic (pure)

## Out of scope

- Approval-per-step mode in any form
- Cross-task / cross-run undo
- Snapshot diff visualisation (V1: full record restore only)
- Snapshot-based replay (V1: undo only, no fast-forward)
- Preview-mode cost forecasting (showing operator the estimated cost of the real run from the Preview)
- A timeline visualisation of all agent actions across all tasks
- Multi-tenant snapshot sharing of any kind

## Success criteria

1. An operator can create a recurring task in Preview mode, review the plan, promote it to a real run, and have the real run execute the plan as described.
2. An operator can undo the last agent action on any tenant-owned record within the retention window.
3. If a human edits a record after the agent touched it, the undo for the agent's action is disabled (no silent overwrite of human work).
4. Preview mode adds zero overhead to normal Run mode (default execution path unchanged).
5. Snapshot storage stays within a per-tenant quota; tenants over quota get a warning before the oldest snapshots are GC'd.

## What unblocks when this ships

- Operators gain confidence to schedule recurring tasks without the "what if it runs wrong every morning" anxiety.
- Trust-onboarding for new operators improves: they can preview before committing on every task until they're comfortable.
- Workspace edits become recoverable, reducing the "the agent overwrote my work" support load.
- The skill `describe` hook becomes a foundation for future capabilities (cost forecasting per skill, dry-run testing in skill development).

## Concurrent safety note

Fully isolated from the other repo-pattern builds. Touches task creation UI, task execution interception, and a new snapshot subsystem. No file overlap with `memory-tiered-consolidation`, `browser-vision-grounding`, or `browser-hardening-primitives`. Safe to run fully concurrent with all three.

## Mockup round

This build is UI-touching. Mockup round runs BEFORE spec authoring. Mockup-designer agent should produce hi-fi clickable prototypes covering:
1. Task creation with Preview option visible
2. Preview output display
3. Promote-to-run flow
4. Undo affordance on a record detail view
5. Quota visibility for snapshots in the usage view

## Provenance

External repo deep-dive 2026-05-17 surfaced DeepSeek-TUI's Plan mode and side-git snapshot patterns. Operator-ratified: lift Preview + snapshots, reject per-step approval mode (Sheets row 5, column D records the decision).

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/task-preview-mode/brief.md
```
