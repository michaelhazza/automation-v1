# Spec — Claude Code framework as a standalone repo

**Build slug:** `framework-standalone-repo`
**Branch (proposed):** `claude/framework-standalone-repo` (separate from `claude/evaluate-summonaikit-B89k3`)
**Status:** draft — pending operator feedback before implementation
**Date:** 2026-05-04
**Author:** session-driven; reviewed before code written

---

## Contents

1. Brief — problem, proposal, benefits, non-goals
2. Architecture — the standalone repo + submodule pattern
3. File ownership boundaries — framework vs project
4. Technical components — what we build
5. Adoption flow — initial drop-in (ADAPT.md, unchanged)
6. Sync flow — ongoing updates (SYNC.md, new)
7. Customisation handling + conflict resolution
8. Migration plan — getting from current state → standalone-repo state
9. Risks + mitigations
10. Implementation phases
11. Open questions for feedback

---

## 1. Brief

### The problem

The Claude Code framework (agent fleet, hooks, governance docs, ADRs, context packs, references) currently lives in two places:

1. **Inside Automation OS** at `.claude/` and various `docs/` paths — the *internal* version, customised with project-specific names and stack details.
2. **Mirrored in `setup/portable/`** in the same repo — the *exportable* version, with placeholders, ready to ship to other repos as a zip.

Today's export model is **one-shot**: build a zip from `setup/portable/`, drop into a target repo, run `ADAPT.md` to substitute placeholders, done. After that, the target repo's framework is frozen at the version that was exported. When the framework improves in Automation OS — better agent prompts, new ADRs, sharper context packs — every target repo has to re-import a new zip manually. Updates do NOT flow.

This is fine for one or two projects. As soon as there are three, four, ten projects all running this framework, the operator (you) is doing manual zip-and-substitute drudgery for every framework improvement. Each target repo also drifts independently — small fixes applied in one don't propagate to the others. The framework's quality degrades because the cost of distributing improvements is high enough that small improvements don't get distributed.

### The proposal

Lift the framework into its own dedicated GitHub repo. Each project that uses the framework adds it as a **git submodule**, then runs a sync script to apply the framework's files (with project-specific substitutions) into the target repo. Future framework improvements become a one-line `git pull` in each target — and a small sync run that handles substitutions and conflict detection automatically.

The framework becomes a versioned, distributable product. Every target repo using version 2.1.0 gets the same fleet, the same conventions, the same governance — until they choose to upgrade to 2.2.0.

### Why this is the right pattern

This pattern is well-trodden:

- **Cookiecutter** (Python project templates) does this for Python.
- **Ruby on Rails** generators do this for Rails apps.
- **Yeoman** does this for JS scaffolding.
- **Backstage software templates** do this at platform-engineering scale.

In every case, the answer is the same: a versioned source-of-truth repo, plus a sync mechanism that handles "the target customised this file" gracefully. We're not inventing anything novel — we're applying a well-understood pattern to a Claude-Code-shaped problem.

### Benefits

| Benefit | Concrete impact |
|---|---|
| **One-command framework upgrade across all projects** | `git submodule update --remote && node .claude-framework/sync.js`. ~30 seconds per repo per upgrade vs ~30 minutes of manual zip-and-substitute. Sync is a controlled generated-file system: the command updates the submodule pointer and re-applies the framework to your target paths, respecting per-file customisation state. Files you've customised are flagged, not overwritten. |
| **Improvements compound** | A bug fix in a single agent prompt benefits every target repo on the next sync. Without this, fixes stay local. |
| **Versioning is explicit** | Each target repo's `.claude/FRAMEWORK_VERSION` declares which framework version it's on. Drift is visible and intentional. |
| **Customisations are detected, not silently overwritten** | If a target repo customised `pr-reviewer.md`, the sync script flags the divergence rather than blowing the customisation away. |
| **Adoption stays cheap** | First-time adoption is still the same `ADAPT.md` walkthrough — but now followed by submodule registration so future updates are free. |
| **Framework dev happens in one place** | All framework improvements happen in the framework repo. Automation OS becomes a *consumer* of the framework, not the source. (Or both — see open question 11.1.) |

### Non-goals

What we are NOT trying to do:

- **NOT** publishing as an npm package, pip package, or any language-specific package manager. The framework is markdown + JSON + JS hooks; there's nothing to compile or runtime-load. Submodule is the right primitive.
- **NOT** building a full template engine (Cookiecutter has a sophisticated Jinja2-based one). Our substitution is simple find-and-replace on a small set of placeholders.
- **NOT** auto-merging customisations. If a target repo customised an agent file beyond placeholder substitution, the sync flags it for manual merge — we do not silently three-way merge.
- **NOT** versioning every framework file independently. The whole framework moves as one semver-versioned bundle. This matches how operators think about the framework ("we're on 2.1.0") and avoids per-file dependency-hell.
- **NOT** trying to support all possible customisation patterns. The boundary between "framework files" and "project files" is drawn deliberately, and customisations to framework files are an exception path, not a primary one.

### Invariants

These hold at every version boundary and are enforced by the sync engine:

1. **Generated-file contract.** Framework-managed files in the target repo are *generated artifacts*. Operators may customise them, but those edits are an explicit opt-in that sacrifices future automatic updates for that file. The mental model: "generated by default; customised by exception." Target repos must treat framework-managed files this way — editing them outside the sync flow is a deliberate choice, not a casual one.

2. **Monotonic non-destructive writes.** Sync never deletes or overwrites a file that has diverged from its last-applied state without explicit operator action. If a file was customised, sync writes the new framework version as `<file>.framework-new` and stops — it does not overwrite the operator's work. Operator action (manual merge + re-running sync) is the only path forward for that file.

---

## 2. Architecture

### Two repos, one direction of flow

```
┌────────────────────────────────────────┐         ┌──────────────────────────────────┐
│  Framework repo                        │         │  Target repo (e.g. Automation OS, │
│  github.com/<owner>/claude-code-       │         │  a new project, etc)              │
│  framework                             │         │                                   │
│                                        │         │  .claude-framework/   ◄───────────┼─── git submodule
│  .claude/agents/         ◄── sources ──┤         │     (read-only mirror of source)  │
│  .claude/hooks/                        │         │                                   │
│  docs/decisions/                       │         │  .claude/agents/      ◄─── synced │
│  docs/context-packs/                   │         │  .claude/hooks/         (with     │
│  docs/spec-context.md                  │         │  docs/context-packs/    placeholder│
│  references/                           │         │  references/             substituted)│
│  ADAPT.md (for adopters)               │         │                                   │
│  SYNC.md (for upgraders)               │         │  CLAUDE.md            ◄── PROJECT │
│  sync.js (the sync engine)             │         │  KNOWLEDGE.md           OWNED     │
│  manifest.json (file list + ownership) │         │  architecture.md        (untouched│
│  FRAMEWORK_VERSION                     │         │  tasks/                  by sync) │
│  CHANGELOG.md                          │         │                                   │
│  README.md                             │         │  .claude/.framework-state.json    │
│                                        │         │  (records substitutions + last-   │
└────────────────────────────────────────┘         │   applied hashes per file)        │
                                                    │                                   │
                                                    └──────────────────────────────────┘
```

**Direction of flow:** improvements flow framework repo → target repo. Never the reverse via sync. (A target can author a fix and PR it back to the framework repo through normal git, but sync never pushes target → framework.)

### Submodule, not subtree, not symlink, not package

Decision: **git submodule**.

Submodule semantics fit the use case:
- Submodule's contents are read-only at the parent level — operators don't accidentally edit the framework's source files in the target repo. They edit the *generated* files in `.claude/`, `docs/`, `references/`. This matches how the framework should be used.
- Updates are explicit: `git submodule update --remote`. No magic.
- The framework is a separately-versioned thing. Submodule's pointer-to-a-commit semantics matches that.
- Removing the framework cleanly: `git submodule deinit && rm -rf .claude-framework`. Compare with subtree's permanent history bleed.

Rejected alternatives:

- **Subtree** — bleeds framework's full history into the target repo's history. Confusing for `git log` and for new contributors. Updates are also more complex.
- **Symlink + script** — fragile, especially on Windows. Doesn't survive `git clone` cleanly on different developer machines.
- **npm/pip package** — only works if every target repo uses that package manager. Most repos do, but the framework also includes hooks (JS) and docs (markdown) that don't fit cleanly into a single language ecosystem. Submodule is language-agnostic.
- **Plain copy** (current zip approach) — what we're moving away from. No update mechanism.

### Submodule path: `.claude-framework/`

Convention:
- Hidden-ish (leading dot) so it doesn't clutter `ls`.
- Named to mirror `.claude/` — anyone who understands `.claude/` understands what `.claude-framework/` is.
- Doesn't conflict with any standard tool's expected directory.

Operators see it as: "the source of truth for our agent fleet lives there; what's in `.claude/` was generated from it."

---

## 3. File ownership boundaries

The framework only manages a defined set of files. Everything else is the target repo's property and never touched.

### Framework-managed (target repo's copy is *generated* from framework)

Files fall into two sync modes:

- **`sync`** — regenerated on every sync (with substitutions re-applied). These are stable framework conventions that improve over time and target repos benefit from receiving updates.
- **`adopt-only`** — scaffolded once at adoption, then owned by the project. Sync never touches them again after the initial drop-in. These are files that become project-specific so quickly that keeping them in sync mode would produce perpetual customisation conflicts.

**Mode `sync` — regenerated on every upgrade:**

- `.claude/agents/*.md` — the agent fleet
- `.claude/hooks/*.js`, `.claude/hooks/*.sh` — portable hooks
- `.claude/settings.json` — hook registration block (sync only owns the `hooks` block; flat-merge rules in §4.6)
- `.claude/FRAMEWORK_VERSION` — version pointer
- `.claude/CHANGELOG.md` — copy of the framework's changelog
- `docs/decisions/0001-*.md`, `0002-*.md`, `0005-*.md` — generic ADRs that ship in the framework
- `docs/decisions/README.md`, `docs/decisions/_template.md` — the ADR convention itself
- `docs/context-packs/*.md` — all five packs + README
- `docs/spec-authoring-checklist.md` — convention
- `docs/frontend-design-principles.md` — rules
- `references/test-gate-policy.md`
- `references/spec-review-directional-signals.md`

**Mode `adopt-only` — scaffolded at adoption, project-owned after:**

- `docs/spec-context.md` — framing template (operator fills in project framing block at adoption)
- `docs/frontend-design-examples.md` — origin examples (operator customises or deletes at adoption)
- `docs/doc-sync.md` — template (operator adds domain-specific rows at adoption)
- `references/verification-commands.md` — stack template (operator fills in at adoption)

### Target-owned (framework never touches)

- `CLAUDE.md` — yours. Adoption inserts framework sections; sync may *suggest* updates to those sections via the changelog, but never auto-edits.
- `KNOWLEDGE.md` — yours.
- `architecture.md` — yours.
- `DEVELOPMENT_GUIDELINES.md` — yours (if present).
- `docs/decisions/0006-*.md`, `0007-*.md`, … — your project-specific ADRs (numbering starts at 0006 to preserve framework's 0003/0004 gap as a marker). **Rule:** any file in `docs/decisions/` not explicitly listed in the manifest as a managed entry is project-owned. Sync never touches it.
- `tasks/` — entirely yours. Adoption seeds empty templates; sync never re-writes anything in `tasks/`.
- All your application code (`server/`, `client/`, `shared/`, etc.).

### Mixed ownership (sync recognises and preserves operator additions)

- `.claude/settings.json` — framework owns the `hooks` block; operator may add other top-level keys (e.g. `permissions`, `env`). Sync replaces only the `hooks` block.

### Why this boundary works

The boundary is drawn so that **the framework doesn't need to understand the project, and the project doesn't need to understand framework internals**. They communicate through:

1. **The `.claude/.framework-state.json` file** — written by adoption, read by sync. Contains substitutions + per-file last-applied hashes.
2. **The framework's `manifest.json`** — declares which files are framework-managed (the list above). Sync reads it to know what to operate on.
3. **The CHANGELOG** — informational. Sync doesn't parse it; the operator reads it to understand what's new.

---

## 4. Technical components

### 4.1 The framework repo

A new GitHub repo (recommended name: `claude-code-framework`).

Contents at the repo root:

```
claude-code-framework/
├── .claude/
│   ├── agents/          (20 files, with placeholders)
│   ├── hooks/           (4 files: long-doc-guard, correction-nudge, config-protection, code-graph-freshness-check)
│   ├── settings.json    (hooks block only; consumers merge with their own settings)
│   ├── FRAMEWORK_VERSION
│   └── CHANGELOG.md
├── docs/
│   ├── context-packs/   (5 packs + README)
│   ├── decisions/       (3 portable ADRs + README + template)
│   ├── doc-sync.md
│   ├── frontend-design-principles.md
│   ├── frontend-design-examples.md
│   ├── spec-authoring-checklist.md
│   └── spec-context.md
├── references/
│   ├── test-gate-policy.md
│   ├── spec-review-directional-signals.md
│   └── verification-commands.md
├── tasks/                (empty scaffolding for adopters to copy)
│   └── builds/_example/  (templates: handoff.md, plan.md, progress.md)
├── ADAPT.md              (one-shot adoption walkthrough)
├── SYNC.md               (NEW — ongoing-update walkthrough)
├── sync.js               (NEW — the sync engine)
├── manifest.json         (NEW — declares which files are framework-managed)
├── README.md             (drop-in instructions)
└── LICENSE
```

The repo's structure intentionally **mirrors how the files appear in target repos**. There is no separate `src/` directory or build step. What you see in the framework repo is what gets dropped into target repos.

### 4.2 `manifest.json` — file ownership declaration

```json
{
  "frameworkVersion": "2.1.0",
  "managedFiles": [
    {
      "path": ".claude/agents/*.md",
      "category": "agent",
      "mode": "sync",
      "substituteAt": "adoption"
    },
    {
      "path": ".claude/hooks/*.{js,sh}",
      "category": "hook",
      "mode": "sync",
      "substituteAt": "never"
    },
    {
      "path": ".claude/settings.json",
      "category": "settings",
      "mode": "settings-merge",
      "substituteAt": "never"
    },
    {
      "path": "docs/decisions/0001-*.md",
      "category": "adr",
      "mode": "sync",
      "substituteAt": "never"
    },
    {
      "path": "docs/context-packs/*.md",
      "category": "context-pack",
      "mode": "sync",
      "substituteAt": "adoption"
    },
    {
      "path": "docs/spec-authoring-checklist.md",
      "category": "reference",
      "mode": "sync",
      "substituteAt": "never"
    },
    {
      "path": "docs/frontend-design-principles.md",
      "category": "reference",
      "mode": "sync",
      "substituteAt": "never"
    },
    {
      "path": "references/test-gate-policy.md",
      "category": "reference",
      "mode": "sync",
      "substituteAt": "never"
    },
    {
      "path": "references/spec-review-directional-signals.md",
      "category": "reference",
      "mode": "sync",
      "substituteAt": "never"
    },
    {
      "path": "docs/spec-context.md",
      "category": "template",
      "mode": "adopt-only",
      "substituteAt": "adoption"
    },
    {
      "path": "docs/frontend-design-examples.md",
      "category": "template",
      "mode": "adopt-only",
      "substituteAt": "adoption"
    },
    {
      "path": "docs/doc-sync.md",
      "category": "template",
      "mode": "adopt-only",
      "substituteAt": "adoption"
    },
    {
      "path": "references/verification-commands.md",
      "category": "template",
      "mode": "adopt-only",
      "substituteAt": "adoption"
    }
  ],
  "removedFiles": [],
  "doNotTouch": [
    "CLAUDE.md",
    "KNOWLEDGE.md",
    "architecture.md",
    "DEVELOPMENT_GUIDELINES.md",
    "tasks/**"
  ]
}
```

Glob expansion is **deterministic**: globs expand in lexicographic order, consistent across operating systems. Sync processes files in that order.

`mode` semantics:
- `"sync"` — re-applied on every upgrade if the file is clean.
- `"adopt-only"` — scaffolded once at adoption, never touched by subsequent syncs.
- `"settings-merge"` — special merge logic (§4.6); not a full regenerate.

`removedFiles` entries (added when a file leaves the framework):
```json
{
  "path": "references/old-file.md",
  "removedIn": "2.3.0",
  "action": "warn-only"
}
```
Default action is `warn-only` — sync prints a notice that the file is orphaned; it never deletes automatically. The operator removes the file manually.
```

Sync reads this manifest to know what it operates on. Adding a new framework file means: drop it in, add a row to the manifest, bump version, push. Targets pick it up on next sync.

### 4.3 `.claude-framework/` submodule in the target repo

Standard git submodule:

```bash
git submodule add https://github.com/<owner>/claude-code-framework.git .claude-framework
git commit -m "feat: adopt claude-code-framework as submodule"
```

In `.gitmodules`:
```
[submodule ".claude-framework"]
    path = .claude-framework
    url = https://github.com/<owner>/claude-code-framework.git
    branch = main
```

The submodule's `branch = main` means `git submodule update --remote` pulls latest from main (we use semver tags too — see §4.7).

### 4.4 `.claude/.framework-state.json` — adoption record

Written by adoption (ADAPT.md Phase 5). Read by sync.

```json
{
  "frameworkVersion": "2.1.0",
  "adoptedAt": "2026-05-04T10:00:00Z",
  "adoptedFromCommit": "abc123def456",
  "profile": "STANDARD",
  "substitutions": {
    "PROJECT_NAME": "Acme Platform",
    "PROJECT_DESCRIPTION": "a customer billing platform",
    "STACK_DESCRIPTION": "Node + Express + Drizzle ORM (PostgreSQL)",
    "COMPANY_NAME": "Acme Inc"
  },
  "files": {
    ".claude/agents/architect.md": {
      "lastAppliedHash": "sha256-of-substituted-content",
      "lastAppliedFrameworkVersion": "2.1.0",
      "lastAppliedFrameworkCommit": "abc123def456",
      "lastAppliedSourcePath": ".claude/agents/architect.md",
      "customisedLocally": false
    },
    ".claude/agents/pr-reviewer.md": {
      "lastAppliedHash": "sha256-of-substituted-content",
      "lastAppliedFrameworkVersion": "2.1.0",
      "lastAppliedFrameworkCommit": "abc123def456",
      "lastAppliedSourcePath": ".claude/agents/pr-reviewer.md",
      "customisedLocally": true
    }
  },
  "syncIgnore": []
}
```

Tracks:
- Which framework version we're on.
- The substitution map (so re-substitution on update is automatic).
- Per-file `lastAppliedHash` — sha256 of the substituted content that sync wrote. This is the **only** divergence signal sync uses: if `sha256(current target file) !== lastAppliedHash`, the file was locally modified.
- Per-file `lastAppliedFrameworkVersion`, `lastAppliedFrameworkCommit`, `lastAppliedSourcePath` — future-proofs old-base retrieval for manual merge assistance.
- Per-file `customisedLocally` — **informational only**; set automatically by sync when it detects a hash mismatch. NOT an operator control. To opt a file out of future syncs, add it to `syncIgnore`.
- `syncIgnore` — **the sole opt-out mechanism**. Files listed here are skipped entirely by sync (no `.framework-new` written, no warnings). Use for files you've heavily customised and permanently own.

### 4.5 `sync.js` — the sync engine

Lives in the framework repo. Invoked from the target repo as `node .claude-framework/sync.js`.

Logic in pseudocode:

```
1. Read target's .claude/.framework-state.json
2. Read .claude-framework/manifest.json
3. Expand all managedFiles globs in lexicographic order (deterministic, cross-platform).
4. Read .claude-framework/.claude/FRAMEWORK_VERSION (the new version).
5. If state.frameworkVersion === new version: print "already on latest (v<X>)", exit 0.
6. For each framework-managed file (in glob-expansion order):
   a. If file is in state.syncIgnore: skip silently.
   b. If file.mode === "adopt-only": skip (project owns it after adoption).
   c. If file.mode === "settings-merge": apply flat-merge logic (§4.6), skip to next file.
   d. Read the current target file content. Normalise: strip BOM, LF endings, strip trailing whitespace per line.
   e. Compute sha256(normalised content). Compare to state.files[path].lastAppliedHash.
   f. If hashes match (file is clean — operator hasn't edited it since last sync):
      - Read new framework source, apply substitutions from state.json.
      - Write substituted content to target path.
      - Update state.json: lastAppliedHash, lastAppliedFrameworkVersion, lastAppliedFrameworkCommit.
   g. If hashes differ (file was locally modified):
      - Set state.files[path].customisedLocally = true (informational).
      - Read new framework source, apply substitutions, write to <target-path>.framework-new.
      - Print: "MANUAL MERGE: <path> customised — see <path>.framework-new for new framework content.
               Merge manually, delete .framework-new, re-run sync to update the hash."
      - Do NOT overwrite the target file.
7. For each file in manifest.removedFiles:
   - If state records lastAppliedHash for the file and file still exists in target:
     - Print: "WARN: <path> removed from framework in v<removedIn>. Remove manually if it was framework-managed."
   - Never delete automatically.
8. Read CHANGELOG entries between old and new versions. Print summary.
9. Update state.json: frameworkVersion = new version.
10. Exit 0. Print: N files updated, M customised (.framework-new written), K removal warnings.

INVARIANT: sync.js never stages, commits, pushes, or deletes files. The operator commits the result.
```

Flags:

| Flag | Behaviour |
|------|-----------|
| `--adopt` | First-run mode: no existing state.json. Copy all managed files fresh, write initial state.json. |
| `--dry-run` | Print what would change without writing anything. Shows which files are clean vs customised. |
| `--check` | Exit 0 if all managed sync-mode files are clean and up-to-date; exit 1 otherwise. For CI gates. |
| `--doctor` | Diagnose state.json health: orphaned entries, missing files, hash mismatches. No writes. |

Implementation: TypeScript, ~250 lines. Standalone — no dependencies beyond Node stdlib (`fs/promises` + a small lexicographic glob expander).

### 4.6 `.claude/settings.json` hook merge contract

`.claude/settings.json` has `mode: "settings-merge"` in the manifest — sync does not regenerate it wholesale, it merges only the `hooks` block using a deterministic flat-merge contract.

Claude Code requires a flat hooks shape: `{ "hooks": { "<HookEventName>": [<handler1>, ...] } }`. Namespaced sub-objects are not supported.

Flat-merge rules:

1. **Framework ownership** — the framework owns hook entries whose `command` field references a file under `.claude/hooks/` (the framework's own hook scripts). Sync regenerates exactly those entries on every upgrade.
2. **Project hooks coexist** — any hook entry the operator added (referencing a non-framework script or an inline command) is preserved. Sync never removes project hooks.
3. **Collision rule** — if a framework hook and a project hook both target the same hook event, the project hook is preserved and the framework hook is also written. Neither wins outright; both coexist. If there is a true collision on the same script path, **project wins** (the framework's version is not written).
4. **Order** — framework hooks are written first, then project hooks. Claude Code executes hooks in array order; document this in SYNC.md so operators know how to reorder if needed.
5. **Testable invariant** — the flat-merge contract has unit tests in `sync.test.ts` verifying: framework hooks present + project hooks preserved + no duplicates.

### 4.7 Versioning & releases on the framework repo

- **Semver in FRAMEWORK_VERSION** (already established at 2.1.0 today).
- **Git tags** at every release: `v2.1.0`, `v2.2.0`, etc. Tags are immutable.
- **Branches** for ongoing work: `main` is the rolling-latest. Major changes can use feature branches that merge to main.
- **Optional later:** GitHub Releases with auto-generated changelog. Not required for v1.

Target repos pin to `branch = main` in `.gitmodules` by default (rolling). Operators who want to lock to a version edit `.gitmodules` to `branch = v2.1.0`.

---

## 5. Adoption flow — initial drop-in (ADAPT.md, with one new step)

The existing `ADAPT.md` walkthrough we already authored stays mostly intact. One new step at the end records adoption state.

```
PHASE 0 — Confirm prerequisites          (existing)
PHASE 1 — File placement                 (existing — but uses submodule, see below)
PHASE 1.5 — Profile selection            (existing)
PHASE 2 — Substitute placeholders         (existing)
PHASE 3 — Customise verification + anchors (existing)
PHASE 4 — Wire into target CLAUDE.md     (existing)
PHASE 5 — Verify                         (existing)
PHASE 6 — Record adoption state          (NEW)
```

### Phase 1 — file placement, submodule-aware

In the target repo:

```bash
# Add submodule
git submodule add https://github.com/<owner>/claude-code-framework.git .claude-framework
git submodule update --init

# Run sync's "first run" mode, which copies framework files into target paths
node .claude-framework/sync.js --adopt
```

The `--adopt` flag tells sync.js: this is the first run, no existing state.json, copy everything fresh, then proceed to substitution phase.

### Phase 6 — record adoption state (NEW)

After ADAPT.md's existing Phase 5 verification completes, write `.claude/.framework-state.json` capturing:

- The substitutions just applied
- The framework version adopted
- The framework's commit SHA at adoption time
- Per-file hashes of the substituted content (so future syncs can detect customisations)

This is the single artifact that turns adoption from one-shot into syncable.

---

## 6. Sync flow — ongoing updates (NEW: SYNC.md)

When the framework releases a new version, target repos pull and apply.

### Operator command (in target repo)

```bash
cd .claude-framework
git pull
cd ..
node .claude-framework/sync.js
```

Or in one line:
```bash
git submodule update --remote && node .claude-framework/sync.js
```

### What sync.js does

For each framework-managed file with mode `sync` (per `manifest.json`):

1. Read the target file's current content and normalise it (BOM stripped, LF endings, trailing whitespace stripped).
2. Compute `sha256(normalised content)`. Compare to `state.files[path].lastAppliedHash`.
3. **If hashes match** (file is clean — no local edits since last sync): read new framework source, apply substitutions, write to target, update `lastAppliedHash` and `lastAppliedFrameworkVersion`.
4. **If hashes differ** (file was locally modified since last sync): write the new substituted framework content to `<path>.framework-new` (a sibling file). Print a warning. Leave the target file untouched.

The state hash is the source of truth. Sync does not reconstruct "what the old framework version said" from the current submodule — after `git submodule update --remote`, the submodule already points at the new version, so that reconstruction would compare against the new content, not the previously-applied content.

After processing all files:
- Print a one-page report: `N updated`, `M skipped (customised)`, `K manual merges pending`.
- Print the changelog excerpt for versions between old and new.
- Operator commits the changes in their target repo.

### SYNC.md — the prompt

`SYNC.md` is the equivalent of `ADAPT.md` but for upgrades. Operator pastes:

```
Read .claude-framework/SYNC.md and execute the upgrade flow.
The current framework version is in .claude-framework/.claude/FRAMEWORK_VERSION.
The target version recorded in this repo is in .claude/.framework-state.json.
```

SYNC.md instructs Claude to:
1. Diff the two versions.
2. Read the changelog entries for what changed.
3. Run `sync.js`.
4. Walk the operator through any pending manual merges (file by file, suggesting which side to keep).
5. Report what's done, what's pending, and what to commit.

This gives the operator a guided experience for upgrades, not just "run a script and hope."

---

## 7. Customisation handling

The non-trivial case: a target repo has customised a framework file (added a project-specific step to `pr-reviewer.md`, say) AND the framework has updated that same file. Standard three-way merge problem.

### Detection

`state.json.files[<path>].lastAppliedHash` is the framework version that was last cleanly written. If `sha256(target's current file) !== lastAppliedHash`, the operator has edited it — flag as customised.

### Resolution flow (v1 — simple and safe)

When sync detects a customised file with a framework update pending:

1. Sync reads the new framework source, applies substitutions, and writes the result to `<path>.framework-new` (a sibling file in the same directory).
2. Sync logs: `MANUAL MERGE: <path> — your customised version is unchanged; new framework content is in <path>.framework-new. Merge manually, delete <path>.framework-new, and re-run sync to update the hash.`
3. The target file is left untouched. Operator reviews the two versions, decides what to keep, writes the merged content, deletes `<path>.framework-new`, and re-runs sync to confirm the hash updates.

A full three-way diff (operator current + old framework base + new framework) requires reliably retrieving the old framework base from git history. That's deferred to a future version when per-file `lastAppliedFrameworkCommit` (now recorded in state.json) can be used to fetch it.

### Why not auto-merge?

Three-way merging markdown files reliably is hard. Even `git merge` punts to the operator on non-trivial conflicts. Sync's job is **detection and surfacing**, not automation.

### Opting out of framework updates for a file

Add the file path to `syncIgnore: [...]` in state.json. Sync skips those files entirely — no `.framework-new` written, no warnings. This is the authoritative opt-out mechanism and the only operator control in state.json.

`customisedLocally: true` is **informational only** — set automatically by sync when it detects a hash mismatch. It is not an operator control. Setting it manually has no effect on sync behaviour; only `syncIgnore` does.

---

## 8. Migration plan

Getting from current state to the standalone-repo state.

### Current state (post this branch)

- `claude-code-framework` does not exist as a repo.
- Automation OS contains:
  - Internal framework files at `.claude/`, `docs/decisions/`, `docs/context-packs/`, `references/`, etc. (project-specific names baked in)
  - Mirror at `setup/portable/` with placeholders ready (the portable bundle from this session)
  - Build script at `scripts/build-portable-framework.ts` that produces a zip from `setup/portable/`

### Target state

- `claude-code-framework` is its own GitHub repo, contents = current `setup/portable/` plus the new sync infrastructure (manifest.json, sync.js, SYNC.md).
- Automation OS uses the framework as a submodule. Its `.claude/`, `docs/decisions/`, etc. are tracked by `.claude/.framework-state.json` and synchronisable.
- `setup/portable/` and `scripts/build-portable-framework.ts` in Automation OS are removed (their content lives in the framework repo).

### Migration steps

1. **Create the new GitHub repo** `claude-code-framework`. Default branch `main`. Empty initial commit.

2. **Author manifest.json + sync.js + SYNC.md** in a new branch in *this* repo (Automation OS). Path: `setup/portable/manifest.json`, `setup/portable/sync.js`, `setup/portable/SYNC.md`. Build them as a normal feature so they can be reviewed before the lift.

3. **Test sync.js end-to-end** in this repo against `setup/portable/` as both source and target (synthetic test). Confirm: substitutions apply correctly, customisation detection works, the merge flow surfaces the right files.

4. **Lift `setup/portable/` → claude-code-framework repo.** Single commit on the new repo: copy entire contents of `setup/portable/`, including the new manifest/sync/SYNC.md, to the framework repo's root. Push.

5. **Tag `v2.1.0` on the framework repo.** First public version.

6. **In Automation OS:** add the framework as a submodule at `.claude-framework/`.
   ```bash
   git submodule add https://github.com/<owner>/claude-code-framework.git .claude-framework
   ```

6.5. **Preflight diff — classify Automation OS divergence from `setup/portable/`.**

   Before running `sync.js --adopt`, diff each current internal file (`.claude/agents/*`, `docs/decisions/0001-*.md`, etc.) against the substituted equivalent in `setup/portable/`. Classify every difference into one of three buckets:

   - **Expected project customisation** — edits that are inherently Automation OS-specific (internal team names, stack-specific agent behaviour, Automation OS-only conventions). These survive self-adoption: sync will detect the hash mismatch and write `.framework-new`, which you can discard.
   - **Framework drift to backport** — improvements made directly to `.claude/agents/*` or other managed files that belong in the framework (better prompts, new conventions, bug fixes). **Backport these to `setup/portable/` and push to the framework repo before step 7.** This ensures the improvement ships in the framework's baseline and isn't accidentally overwritten.
   - **Accidental divergence** — whitespace, normalisation differences, stale edits without intent. Accept the framework version; treat as clean on sync.

   This classification can be done with a diff tool or scripted. The goal: no silent loss of internal refinements when self-adoption runs.

7. **Self-adopt.** Run `node .claude-framework/sync.js --adopt` in Automation OS. Substitution map: `{PROJECT_NAME: "Automation OS", ...}`. This generates `.claude/.framework-state.json` capturing the current state. The actual files in `.claude/`, `docs/`, etc. are already in place and substituted, so sync should detect "already in sync" and just write state.json without overwriting anything.

8. **Remove obsolete in-repo paths.**
   ```bash
   git rm -rf setup/portable/
   git rm scripts/build-portable-framework.ts
   git commit -m "chore: lift portable framework into claude-code-framework repo"
   ```

9. **Update Automation OS's CLAUDE.md** — replace the framework-version section with one that points at `.claude-framework/` and `.claude/.framework-state.json`.

10. **Verify** by running `validate-setup` agent (which is now framework-resident in `.claude-framework/`).

11. **Document the upgrade protocol** in framework repo's CHANGELOG.md § Upgrade protocol (mostly already there from v2.0.0).

### What this looks like for a NEW target repo (post-migration)

```bash
cd ~/projects/new-project
git submodule add https://github.com/<owner>/claude-code-framework.git .claude-framework
# Open Claude Code on Opus, paste:
#   "Read .claude-framework/ADAPT.md in full and execute the phases.
#    Profile: STANDARD
#    Project name: New Project
#    Project description: ..."
# Claude walks Phase 0-6 (last phase records adoption state)
# Done.
```

Future updates:

```bash
git submodule update --remote
node .claude-framework/sync.js
# Or with the SYNC.md guided flow:
#   "Read .claude-framework/SYNC.md and execute the upgrade flow."
```

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Operator unfamiliar with submodules.** Submodule's "stale pointer" semantics can confuse first-time users (`git pull` doesn't update submodules; you need `git submodule update`). | README in framework repo opens with a "if you've never used submodules" primer. ADAPT.md Phase 1 includes the submodule setup walkthrough. The two commands operators need (`git submodule update --remote` and `node .claude-framework/sync.js`) become muscle memory in <3 uses. |
| **Customisation detection produces false positives.** Whitespace differences, line-ending differences (Windows CRLF vs Unix LF), trailing newlines could trigger false "customised" warnings. | Sync normalises content before hashing: strip BOM, normalise line endings to LF, strip trailing whitespace per line, collapse trailing blank lines. Test on Windows + macOS + Linux before release. |
| **Framework changes that require coordination.** A breaking change in the framework (e.g., agent file structure change) would need every target repo to migrate. | The CHANGELOG's `Breaking:` section documents migrations. Sync prints breaking-change notices prominently. Operators can pin to an older version (`branch = v2.1.0` in `.gitmodules`) until they're ready to migrate. |
| **Substitution placeholders accidentally appear in operator content.** If an operator types `[PROJECT_NAME]` in a project file (e.g., as a literal example in their own CLAUDE.md), and that file gets framework-managed status by mistake, sync would re-substitute it. | The manifest's `doNotTouch` list prevents this for project-owned files. Sync NEVER touches CLAUDE.md, KNOWLEDGE.md, etc. The substitution map only applies to framework-managed files per the manifest. |
| **The framework repo's history grows.** If we frequently iterate on agent prompts, the framework repo accumulates many small commits. | Acceptable. The framework repo is small (~200 KB content); even with thousands of commits it stays manageable. Submodule clone is fast. |
| **Two repos to maintain.** Releases now require pushing to the framework repo *and* updating the submodule pointer in target repos. | This is the cost of distribution. The win is that updates flow to N target repos for the cost of pushing once. As long as N ≥ 2, it pays back. |
| **What if GitHub goes down / framework repo gets deleted?** Submodule updates fail until the source is reachable. | Each target repo's submodule clone is a complete copy; existing target repos continue to function indefinitely without framework-repo access. They just can't pull updates. Mitigation: optionally mirror the framework repo to a second remote. |
| **Cross-platform line ending issues.** Submodule files cloned on Windows get CRLF; on macOS get LF. Sync's hash compare must handle this. | `.gitattributes` in framework repo: `*.md text eol=lf` to force LF. Sync normalises before hash. Tested cross-platform before release. |
| **State file corruption or loss.** If `.framework-state.json` is corrupted or deleted, sync cannot distinguish clean from customised files. | `sync.js --doctor` diagnoses the issue. `sync.js --dry-run` lets the operator inspect before writing. State can be partially reconstructed by re-hashing current files against the framework source — files that match are clean; files that differ are treated as customised. |
| **Framework file rename or deletion.** Renamed or deleted files in the framework create orphaned generated files in target repos that receive no further updates. | Manifest `removedFiles` entries with `action: warn-only` inform operators. Rename: treated as delete + add (old file orphaned; new file adopted). Never auto-deleted. |
| **Settings merge collision.** Hook entries from framework and project could conflict on ordering or be duplicated across syncs. | Flat-merge contract (§4.6): framework owns entries referencing `.claude/hooks/*`; project hooks coexist; project wins on true collision; framework-first ordering. Deterministic rules, covered by unit tests. |
| **Self-adoption drift.** Automation OS internal files may have diverged from `setup/portable/` beyond placeholder substitution, causing silent overwrites or noisy migration PRs. | Preflight diff (§8 step 6.5) classifies all differences before self-adoption runs. Framework drift is backported first. |
| **Submodule dirty state.** Operators may accidentally edit framework source files inside the target repo's `.claude-framework/` submodule checkout. | `sync.js` checks submodule clean status before running; exits with an error if `.claude-framework/` has uncommitted changes. (The `setup/portable/` approach: framework source is read-only because there's nothing to edit in-place.) |
| **Tag/branch confusion.** `.gitmodules branch = v2.1.0` uses a branch name to mean a tag; submodule update behaviour differs between branch tracking and tag pinning. | Document the distinction: to pin to a specific version, remove `branch` from `.gitmodules` and lock the submodule to a tag commit via `git -C .claude-framework checkout v2.1.0 && git add .claude-framework`. Rolling latest uses `branch = main`. Never use `branch = v2.1.0` to mean "track tag v2.1.0." |
| **Security/trust of `sync.js`.** Target repos execute JavaScript from the framework submodule; a compromised framework repo could run arbitrary code. | Initial posture: private repo (§11.2) limits exposure. Review `sync.js` changes before updating the submodule pointer to a new version. Signed git tags provide verification that the code matches what was reviewed. |
| **Placeholder collision.** Simple find-replace for substitution placeholders may accidentally match examples, code blocks, or comments inside agent files that happen to contain the placeholder text. | Use delimited placeholder syntax (e.g., `{{PROJECT_NAME}}` rather than bare `[PROJECT_NAME]`) and scope substitution to manifest-declared files only. Test with intentionally collision-prone content before release. |

---

## 10. Implementation phases

### Phase A — sync infrastructure built and tested in Automation OS (1-2 days)

Stay on this branch (or a successor). Do not lift to a separate repo yet. Build:

- `setup/portable/manifest.json` — file ownership declaration
- `setup/portable/sync.js` — sync engine (~200 lines TypeScript)
- `setup/portable/SYNC.md` — upgrade walkthrough prompt
- Update `setup/portable/ADAPT.md` to add Phase 6 (record adoption state)
- Test cases: synthetic target repo, exercise adopt + sync + customisation detection + merge flow
- Update `setup/portable/README.md` to describe the submodule + sync model

Validation: run sync on a synthetic target (e.g., a temp directory) seeded from `setup/portable/`. Confirm initial adoption + a simulated framework update + a simulated customisation + a merge flow all work.

Bump framework version to **2.2.0** (additive: sync infra is new, no breaking changes).

### Phase B — lift to standalone repo (~30 minutes)

- Create GitHub repo `claude-code-framework` (or operator's chosen name).
- Copy `setup/portable/` contents → framework repo root. Single commit.
- Tag `v2.2.0`.
- Verify it clones cleanly into a fresh checkout.

### Phase C — Automation OS migrates to consume the framework (1 hour)

Steps 6-10 of § 8 Migration plan above. Output: Automation OS runs on the framework as a submodule, with state.json tracking, framework files lifted out of the working tree.

### Phase D — first NEW target repo onboards (30 minutes)

Pick a real project that needs the framework. Open in Claude Code on Opus. Paste the ADAPT.md prompt. Walk the phases. Verify.

This is the proof of value — and the first time the framework's distribution model is exercised end-to-end.

### Phase E — second target repo onboards (15 minutes)

Should be faster than Phase D because Phase D uncovered any wrinkles. After two successful adoptions, the framework's distribution model is validated.

### Phase F — first framework upgrade flows out (15 minutes per target)

When a real improvement is needed (a bug in an agent prompt, a new convention to add):
1. Make the change in the framework repo. Commit. Bump version. Tag.
2. In each target repo: `git submodule update --remote && node .claude-framework/sync.js`.
3. Confirm sync's verdict, commit any updates in the target.

This is where the win compounds. Every subsequent improvement is one push + N quick syncs.

---

## 11. Open questions for operator feedback

These are the genuine uncertainties — feedback shapes the implementation.

### 11.1 Framework dev location — Decision: Option B

**Decision: Automation OS is a consumer. Framework dev happens in a separate framework repo checkout.**

The clarifying reframe: "where is framework development *authored*, and how do changes flow back into framework source without editing generated target files?" Option A conflates the editing surface with the consumer, which creates a subtle long-term decay risk: you edit `.claude/agents/pr-reviewer.md` in Automation OS (generated copy), forget to upstream it to the framework, and the improvement is lost.

**Operational posture:**
- Framework repo = source of truth
- Automation OS = consumer, pulls updates via `git submodule update --remote && node .claude-framework/sync.js`
- Framework dev: open a separate editor window on the framework repo checkout (convenience), or work directly in a framework-repo branch

**Rule: never edit `.claude/agents/*`, `.claude/hooks/*`, or any other framework-managed file in Automation OS directly.** If you catch an improvement, open the framework repo and make the change there. Self-adoption (§8) puts the right process in place.

### 11.2 Public or private GitHub repo? — Decision: private initially

**Decision: private GitHub repo initially.**

The framework encodes prompt architecture, review heuristics, and operating patterns — once public, you cannot easily retract or reshape. Path: build privately, stabilise across 2–3 repos, then decide whether to open-source a cleaned version later.

Operationally: target repos use a private submodule URL (`git@github.com:<owner>/claude-code-framework.git`). Each machine/CI environment needs an SSH key or PAT with read access to the framework repo. See security risk in §9 for the trust model.

### 11.3 CLI wrapper — Decision: defer wrapper; add diagnostic flags

**Decision: defer the npm wrapper; ship `--dry-run`, `--check`, and `--doctor` flags in v1.**

The two-command sequence (`git submodule update --remote && node .claude-framework/sync.js`) is fine for v1. The npm wrapper adds per-repo `package.json` changes for minimal gain.

Higher-leverage flags ship in v1 instead:
- `--dry-run` — show what would change without writing. Use before every upgrade.
- `--check` — CI-ready exit code (0 = all clean, 1 = updates or customisations pending).
- `--doctor` — diagnose state.json health (orphaned entries, missing files, hash mismatches).

Add the npm wrapper wrapper later if the two-command sequence generates friction across multiple repos.

### 11.4 Auto-commit — Decision: no auto-commit (invariant)

**Decision: sync.js never stages, commits, pushes, or deletes files. The operator commits the result.**

This is an invariant, not just a preference. Sync's responsibilities are: detect, update, and surface. Everything else is the operator's. The only exception flags are `--adopt` (which writes state.json on first run) — even then, the commit is manual.

If future tooling (e.g., a SYNC.md-guided Claude session) produces an auto-commit within an explicitly opt-in flow, that is a separate concern and does not affect sync.js's contract.

### 11.5 Origin-specific ADRs (0003, 0004) — Decision: project-owned

**Decision: any file in `docs/decisions/` not explicitly listed in the manifest as a managed entry is project-owned. Sync never touches it.**

The manifest enumerates `0001-*.md`, `0002-*.md`, `0005-*.md`, `README.md`, `_template.md`. All other files in `docs/decisions/` — including `0003-*.md`, `0004-*.md`, and any `0006+` files — are project-owned. They coexist with the framework's managed ADRs and are untouched by sync.

This rule requires no `doNotTouch` entries for individual ADR files — the manifest's explicit inclusion list is the boundary.

### 11.6 Branch handling — Decision: Option A (ship v2.1.0 first, then Phase A on new branch)

**Decision: Option A.**

Commit the v2.1.0 work (validate-setup + portable bundle + zip-build script) on this branch, push, merge. The v2.1.0 work lands as the "final pre-standalone" reference state. Then start Phase A (sync infrastructure) on a new branch as v2.2.0 — additive changes, no breaking changes.

This preserves the work and gives a clean reference state that matches the framework repo's initial commit.

---

## End of spec

**Ready for operator review.** Please flag any of:
- Architecture concerns with the submodule + sync model.
- Disagreement with the file ownership boundaries.
- Missing risks or scenarios.
- Answers to the open questions in § 11.

After your feedback round, I'll iterate the spec or proceed to Phase A implementation.
