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
| **One-line framework upgrade across all projects** | `git submodule update --remote && node .claude-framework/sync.js`. ~30 seconds per repo per upgrade vs ~30 minutes of manual zip-and-substitute. |
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

These files in the target repo are **regenerated** on every sync (with substitutions re-applied):

- `.claude/agents/*.md` — the agent fleet
- `.claude/hooks/*.js`, `.claude/hooks/*.sh` — portable hooks
- `.claude/settings.json` — hook registration block (sync only owns the `hooks` block; preserves any other operator-added blocks)
- `.claude/FRAMEWORK_VERSION` — version pointer
- `.claude/CHANGELOG.md` — copy of the framework's changelog
- `docs/decisions/0001-*.md`, `0002-*.md`, `0005-*.md` — generic ADRs that ship in the framework
- `docs/decisions/README.md`, `docs/decisions/_template.md` — the ADR convention itself
- `docs/context-packs/*.md` — all five packs + README
- `docs/spec-context.md` — template (operator fills in framing block at adoption)
- `docs/spec-authoring-checklist.md` — convention
- `docs/frontend-design-principles.md` — rules
- `docs/frontend-design-examples.md` — origin examples (operator may delete or replace at adoption)
- `docs/doc-sync.md` — template (operator may add domain-specific rows)
- `references/test-gate-policy.md`
- `references/spec-review-directional-signals.md`
- `references/verification-commands.md` — stack template (operator fills in)

### Target-owned (framework never touches)

- `CLAUDE.md` — yours. Adoption inserts framework sections; sync may *suggest* updates to those sections via the changelog, but never auto-edits.
- `KNOWLEDGE.md` — yours.
- `architecture.md` — yours.
- `DEVELOPMENT_GUIDELINES.md` — yours (if present).
- `docs/decisions/0006-*.md`, `0007-*.md`, … — your project-specific ADRs (numbering starts at 0006 to preserve framework's 0003/0004 gap as a marker).
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
      "substituteAt": "adoption",
      "preserveCustomisations": true
    },
    {
      "path": ".claude/hooks/*.{js,sh}",
      "category": "hook",
      "substituteAt": "never",
      "preserveCustomisations": false
    },
    {
      "path": ".claude/settings.json",
      "category": "settings",
      "substituteAt": "never",
      "merge": "hooks-block-only"
    },
    {
      "path": "docs/decisions/0001-*.md",
      "category": "adr",
      "substituteAt": "never",
      "preserveCustomisations": true
    },
    {
      "path": "docs/context-packs/*.md",
      "category": "context-pack",
      "substituteAt": "adoption",
      "preserveCustomisations": true
    },
    {
      "path": "references/*.md",
      "category": "reference",
      "substituteAt": "adoption",
      "preserveCustomisations": true
    }
  ],
  "doNotTouch": [
    "CLAUDE.md",
    "KNOWLEDGE.md",
    "architecture.md",
    "DEVELOPMENT_GUIDELINES.md",
    "tasks/**"
  ]
}
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

The submodule's `branch = main` means `git submodule update --remote` pulls latest from main (we use semver tags too — see § 4.6).

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
      "customisedLocally": false
    },
    ".claude/agents/pr-reviewer.md": {
      "lastAppliedHash": "sha256-of-substituted-content",
      "customisedLocally": true,
      "customisationHash": "sha256-of-current-content"
    }
  },
  "syncIgnore": []
}
```

Tracks:
- Which framework version we're on.
- The substitution map (so re-substitution on update is automatic).
- Per-file last-applied hash (for divergence detection).
- Per-file customisation flag (set when sync detects the operator has edited the file beyond placeholder substitution).

### 4.5 `sync.js` — the sync engine

Lives in the framework repo. Invoked from the target repo as `node .claude-framework/sync.js`.

Logic in pseudocode:

```
1. Read target's .claude/.framework-state.json
2. Read .claude-framework/.claude/FRAMEWORK_VERSION (the latest)
3. If versions equal: print "already on latest", exit 0.
4. Read .claude-framework/manifest.json
5. For each framework-managed file (per manifest):
   a. Compute the EXPECTED current target version: read framework's source, apply state.json's substitutions
   b. Compare expected to target's actual file content
   c. If they match (operator hasn't customised): proceed to step d
   d. If they don't match (customisation detected):
      - Set state.json file.customisedLocally = true
      - Stage three-way merge: write framework version to <file>.framework, target's version unchanged, print warning
      - Skip to next file
   e. Read .claude-framework/<framework-path>, apply substitutions, write to target path
   f. Update state.json file.lastAppliedHash to sha256 of new content
6. Read CHANGELOG between old version and latest. Print summary of what's new.
7. Update state.json frameworkVersion to latest, adoptedAt left unchanged.
8. Exit 0 with a summary of: N files updated, M files skipped (customised), K manual merges pending.
```

Implementation: TypeScript, ~200 lines. Standalone — no dependencies beyond what's in Node stdlib (no chalk, no glob libraries, just `fs/promises` and a small wildcard matcher).

### 4.6 Versioning & releases on the framework repo

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

For each framework-managed file (per `manifest.json`):

1. Read framework's source.
2. Apply substitutions from state.json.
3. Compute expected target content.
4. Compare to target's current content.
5. **If match:** operator hasn't customised. Replace the target file with the new framework version (re-substituted). Update `lastAppliedHash`.
6. **If mismatch:** operator customised it OR the framework changed it. Compare to `lastAppliedHash`:
   - If target = lastAppliedHash: framework changed it, no operator customisation. Replace.
   - If target ≠ lastAppliedHash: customisation detected. Write framework version to `<path>.framework`. Print warning. Operator merges manually.

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

### Resolution flow

When sync detects a customised file with a framework update pending:

1. Sync writes the new framework version to `<path>.framework` (a sibling file).
2. Sync writes a `<path>.merge` text file containing:
   - The operator's current version (the customised one)
   - The framework's old version (read from the submodule's previous tag — known via state.json's `frameworkVersion`)
   - The framework's new version
3. Sync logs: `MANUAL MERGE PENDING: <path> — see <path>.merge for the three-way diff`.
4. Operator opens the merge file, decides what to keep, writes the merged content into the original path, deletes the `.framework` and `.merge` files, runs sync again to pick up the lastAppliedHash recompute.

### Why not auto-merge?

Three-way merging markdown files reliably is hard. Even `git merge` punts to the operator on non-trivial conflicts. We'd ship more bugs than we'd save time. Sync's job is **detection and surfacing**, not automation.

### Setting `customisedLocally: true` deliberately

If an operator wants to opt OUT of framework updates for a specific file (e.g., they've heavily customised an agent and don't want sync to flag it forever), they can set `customisedLocally: true` in state.json and add the file to `syncIgnore: [...]`. Sync skips them — silent ownership transfer to the operator.

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

### 11.1 Should Automation OS be the framework's "home" or a peer consumer?

Two options:

**Option A — Automation OS hosts the framework.** The framework repo's source files are *also* embedded in Automation OS (as the submodule). Framework changes happen in the submodule (in Automation OS or anywhere with checkout access), get pushed to the framework remote, then other target repos pull. Automation OS's own copy of the framework files in `.claude/` etc. is regenerated via sync just like every other consumer. **Automation OS's role:** convenient dev environment for framework changes.

**Option B — Automation OS is just one of many consumers.** Framework dev happens in a dedicated checkout of the framework repo. Automation OS pulls updates the same as any other target. Cleaner separation of concerns, but framework dev requires switching to a separate checkout.

I lean A. Automation OS is where you already work; making framework dev a separate context-switch adds friction. Both options are mechanically equivalent — A just gives you an editing surface alongside the consumer view.

### 11.2 Public or private GitHub repo?

If private: only your accounts can clone. Submodule URL needs auth. Slightly more setup per target, but the framework stays internal.

If public: anyone can use it. Submodule URL is simple HTTPS. Loses the "internal IP" framing. Most likely **fine** for an agent-orchestration framework that's not directly business-IP.

I'd default to public unless there's a specific reason to keep it private. Easier, less auth-fiddling.

### 11.3 Should we also build a `framework:upgrade` CLI in target repos?

Today the operator types two commands: `git submodule update --remote && node .claude-framework/sync.js`. Could be wrapped as `npm run framework:upgrade` (per target repo) for one-line UX.

Cost: requires modifying each target repo's `package.json` (HITL-protected). Adds a dependency on each target having npm.

Benefit: a single canonical command. Lower friction.

Recommendation: don't build it for v1. The two-command sequence is fine. Add the npm wrapper later if friction emerges.

### 11.4 Should sync.js auto-commit?

Today, sync writes files but doesn't commit. Operator commits manually. Pro: matches "no auto-commit" preference. Con: another step per upgrade.

Recommendation: keep manual commit. Sync's report tells the operator what to commit, but the operator owns the commit. This matches the existing CLAUDE.md preference and keeps sync's responsibilities narrow.

### 11.5 What to do with origin-project-specific ADRs (0003, 0004) in Automation OS?

Currently in Automation OS at `docs/decisions/0003-*.md` and `0004-*.md`. The framework only ships 0001/0002/0005. After migration, Automation OS will *consume* the framework — meaning sync writes only those three. So 0003/0004 stay in place (manifest's `doNotTouch` covers `docs/decisions/0006-*` and beyond, but 0003/0004 are pre-existing "between framework files" — do they survive?).

Approach: the manifest's framework-managed list explicitly enumerates `0001-*.md`, `0002-*.md`, `0005-*.md`, README, _template.md. Anything else in `docs/decisions/` (including 0003, 0004) is left alone. Automation OS's existing 0003 / 0004 / 0006+ all coexist with the framework's three.

Confirm this is the desired behaviour.

### 11.6 How do we handle this branch's pending changes?

Right now `claude/evaluate-summonaikit-B89k3` has the v2.1.0 framework + `setup/portable/` + the build-zip script + uncommitted changes (validate-setup, the polish). All of that becomes "moot" once the framework is lifted to its own repo.

Two options:

**Option A** — commit the v2.1.0 work (validate-setup + portable bundle + zip-build script) on this branch, push, **then** start Phase A on a new branch. The v2.1.0 work lands as the "final pre-standalone" state. Tag in Automation OS as a pre-migration marker.

**Option B** — abandon the uncommitted v2.1.0 work, do the lift directly from the existing committed state of `setup/portable/`. We lose the validate-setup agent (though it's read-only and small to recreate in the framework repo) and the zip-build script (less useful once the framework has its own repo).

I lean A — preserves the work and the reference state. Confirm.

---

## End of spec

**Ready for operator review.** Please flag any of:
- Architecture concerns with the submodule + sync model.
- Disagreement with the file ownership boundaries.
- Missing risks or scenarios.
- Answers to the open questions in § 11.

After your feedback round, I'll iterate the spec or proceed to Phase A implementation.
