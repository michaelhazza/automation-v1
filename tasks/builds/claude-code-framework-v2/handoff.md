# Handoff — Claude Code Framework v2 refactor

**Phase complete:** REFACTOR (single multi-round session, no formal phase pipeline used — this was framework-level work, not feature work).
**Branch:** `claude/evaluate-summonaikit-B89k3`
**Build slug:** `claude-code-framework-v2`
**Author:** Single session, 2026-05-03.
**Status:** All in-session work complete. Working tree has uncommitted changes pending operator commit.

---

## Contents

1. Why this work happened
2. Decisions made this session
3. What was built (internal repo)
4. What was built (portable zip)
5. What was deferred (with reasoning)
6. Files inventory — modified + created + moved
7. Audit findings + actions taken
8. Working tree state at handoff
9. Open questions for next session
10. Resume instructions
11. Useful commands for the next session

---

## 1. Why this work happened

The session opened with the operator pasting a marketing landing page for **SummonAI Kit** (a paid tool that auto-generates Claude Code setup files for a project) and asking for an honest take. The recommendation was: skip it, the operator's existing setup is more sophisticated than what the tool generates.

The session then pivoted: the operator asked to **port the existing `automation-v1` setup** to a new codebase. Specifically two artifacts:
1. A drop-in zip file containing the cleaned, generic version of the agent fleet + hooks + reference docs.
2. A master prompt (`ADAPT.md`) that adapts the templates to a new project.

Mid-session, scope expanded to: also fix all the inefficiencies in the internal `automation-v1` setup BEFORE propagating, since the framework will be copy-pasted to multiple repos. The operator wanted "no inefficiencies or issues" carried across.

Final scope:
- **Internal `automation-v1` refactor** — 12 distinct improvements to the agent fleet + reference docs.
- **Portable zip v2** — drop-in-able framework for new repos with full ADAPT.md walkthrough.
- **Audit pass** before propagation — surfaced 6 high-value-high-cost items deferred to future sessions.

---

## 2. Decisions made this session

These are the durable choices. ADRs were written for the architectural ones.

### Decisions captured as ADRs

ADRs at `docs/decisions/`:

- **ADR-0001: Mixed-mode review agents** — auto-fix mechanical, route directional. Covers `spec-conformance` and `spec-reviewer`. The "100% sure or route" gate is the load-bearing piece.
- **ADR-0002: Interactive vs walk-away review agent classification** — classify each review agent at design time. Interactive (`chatgpt-pr-review`, `chatgpt-spec-review`) never auto-defer. Walk-away (`spec-reviewer`, `dual-reviewer`, `spec-conformance`) never block.
- **ADR-0003: Workspace identity uses canonical pattern, one workspace per subaccount** — origin-project specific (agent-as-employee feature). NOT in portable zip.
- **ADR-0004: GEO skills as methodology skills, not intelligence skills** — origin-project specific. NOT in portable zip.
- **ADR-0005: Risk-class split rollout for read-vs-write enforcement gaps** — generic pattern. From the cached-context isolation work.

Portable zip ships ADRs 0001, 0002, 0005 (framework decisions). 0003, 0004 are origin-project only.

### Decisions made but NOT captured as ADRs (judged not durable enough or too narrow)

- KNOWLEDGE.md grows unbounded — added a size-bound policy section to the file's preamble rather than an ADR. Captured operationally, not as an architectural choice.
- Test gates are CI-only — already an established convention; centralised to `references/test-gate-policy.md`. Not ADR-worthy because the rule predates this session.
- Mode-scoped context packs — adopted as a convention but is a tooling pattern, not an architectural choice. Captured in `docs/context-packs/README.md` and the `context-pack-loader` agent.
- Agent fleet count: kept all 19 in the internal repo. Did NOT prune. The portable zip ships all 19 with a profile selector (MINIMAL 4 / STANDARD 10 / FULL 19) — operator picks what they want when running ADAPT.md.

### Decisions explicitly deferred

- **Migrating remaining 6 KNOWLEDGE Decision entries to ADRs** — judged on a per-entry basis; 5 promoted, 6 stayed as observations. The remaining 6 are patterns, research notes, or implementation-specific tradeoffs that don't carry durable architectural rationale.
- **docs/ archive sweep** — initial heuristic surfaced 0 candidates after re-verification. The triage report at `tasks/docs-archive-triage-2026-05-03.md` documents why and the durable enabler shipped instead (Status: header convention).

---

## 3. What was built (internal `automation-v1` repo)

### New agents (3)

- `.claude/agents/hotfix.md` — fast-path coordinator for time-critical fixes. Bypasses the three-coordinator pipeline; still enforces lint + typecheck + targeted test + `pr-reviewer`. Mandatory KNOWLEDGE entry on completion.
- `.claude/agents/context-pack-loader.md` — inline playbook (NOT a sub-agent) that loads a mode-scoped slice of architecture.md instead of the full 3,542-line file. Triggered by operator typing `load context pack: <mode>`. Auto-trigger from `current-focus.md` status when invoked without a mode.
- `.claude/agents/codebase-explainer.md` — produces `docs/codebase-tour.md`, a human-facing narrative onboarding doc. Different audience from architecture.md (which is agent-facing dense reference).

Fleet count: **19 agents** (was 16).

### New conventions (5)

- **ADR convention** at `docs/decisions/`. README, _template.md, and 5 inaugural ADRs.
- **Mode-scoped context packs** at `docs/context-packs/`. Five packs: review, implement, debug, handover, minimal. Each names architecture.md anchor IDs to load.
- **Status: header convention for specs** at `docs/spec-authoring-checklist.md` § 11. Required frontmatter: `Status: draft | reviewing | accepted | shipped | superseded by <path>`. Forward-looking; existing specs not retroactively backfilled.
- **Spec-context staleness gate** in `docs/spec-context.md`: `last_reviewed_at` + `stale_after_days: 60` + `stale_blocks_at_days: 120`. `spec-reviewer` warns then blocks. Wired in `spec-reviewer.md § Step A`.
- **Framework versioning** at `.claude/FRAMEWORK_VERSION` (semver, 2.0.0) + `.claude/CHANGELOG.md`. Tracks framework version per repo so cross-repo drift is detectable. Includes upgrade protocol.

### New references files (2)

- `references/test-gate-policy.md` — single source of truth for "test gates are CI-only" rule. Replaces ~50 lines of duplicated boilerplate across ~10 agent files.
- `references/spec-review-directional-signals.md` — extracted from `spec-reviewer.md` (was 70 lines of inline bullet lists across 8 categories).

### Architecture changes

- **architecture.md anchored** — 54 HTML anchors (`<a id="..."></a>`) added before every `## ` heading via Python script. Deterministic kebab-case slugs. Enables precise context-pack splicing.
- **5 ADRs** at `docs/decisions/`:
  - 0001 — Mixed-mode review agents (auto-fix mechanical, route directional)
  - 0002 — Interactive vs walk-away review agent classification
  - 0003 — Workspace identity canonical pattern (origin-project specific)
  - 0004 — GEO skills as methodology skills (origin-project specific)
  - 0005 — Risk-class split rollout for read-vs-write enforcement gaps

### Slimming

- `spec-reviewer.md`: 575 → 509 lines (38 KB → 36 KB). Directional-signals classifier extracted to references file.
- `frontend-design-principles.md`: 261 → 173 lines. Origin-project worked examples extracted to sibling `frontend-design-examples.md`.

### Archive moves

- `quality-checker-gpt.md` → `docs/_archive/quality-checker-gpt.md` (legacy GPT pipeline doc, only one stale spec referenced it).
- 9 fully-resolved sections from `tasks/todo.md` → `tasks/todo-archive/2026-Q2.md`. todo.md: 2,567 → 2,411 lines (then re-grew to 2,442 with new deferred items).

### Cross-link fixes

- `replit.md` cross-linked from `CLAUDE.md` § Replit boot procedure (was load-bearing but undocumented).
- `references/` directory mention softened in `CLAUDE.md` and `architect.md` from "always check" to "if cache exists, otherwise grep" (the directory was missing — script `scripts/build-code-graph.ts` writes there but had never run).
- `KNOWLEDGE.md` preamble points future architectural decisions to `docs/decisions/` instead of mixing them into the observation stream.
- `docs/doc-sync.md` enumerates all new conventions (ADRs, context-packs, references/, FRAMEWORK_VERSION).

### Tasks scaffolding

- `tasks/todo-archive/2026-Q2.md` — created for the archive sweep.
- `tasks/docs-archive-triage-2026-05-03.md` — triage report explaining why 0 docs were eligible for automated archive and what the path forward is.
- `tasks/builds/claude-code-framework-v2/` (this directory) — new build slug with `handoff.md` (this file).

---

## 4. What was built (portable zip v2)

Zip path: **`~/portable-claude-setup-v2.zip`** (250-254 KB, 76 files).

Contents mirror the internal repo's framework layer with project-specific examples replaced by templates:

- All 19 agent files (cleaned of `Automation OS` / `Synthetos` references; replaced with `[YOUR_PROJECT]` / `[YOUR_COMPANY]` placeholders).
- All 3 portable hooks (`long-doc-guard.js`, `correction-nudge.js`, `config-protection.js`). The two project-specific hooks (`arch-guard.sh`, `rls-migration-guard.js`) deliberately NOT ported.
- New: `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` for cross-repo version tracking.
- 5 docs: `spec-context.md` (with template framing block), `spec-authoring-checklist.md`, `frontend-design-principles.md` (rules only), `frontend-design-examples.md` (origin-project worked examples — to delete or replace), `codebase-audit-framework.md`, `doc-sync.md` (template).
- 5 context packs at `docs/context-packs/`.
- 3 ADRs (0001, 0002, 0005) — framework-level only. 0003, 0004 stayed in internal because they're origin-project specific.
- 3 reference files: `test-gate-policy.md`, `spec-review-directional-signals.md`, `verification-commands.md` (stack-specific commands template).
- Tasks scaffolding: empty `current-focus.md`, `todo.md`, `ideas.md`, `bugs.md`, `lessons.md`, `runbooks/.gitkeep`, `review-logs/README.md`. Plus `tasks/builds/_example/` showing the shape of `handoff.md` + `plan.md` + `progress.md`.
- `ADAPT.md` — master prompt with profile selector (MINIMAL 4 / STANDARD 10 / FULL 19) and full Phase 1/1.5/2/3/4 walkthrough.
- `README.md` — drop-in instructions, profile guide, "what's new in 2.0.0" section.

The portable zip is at `~/portable-claude-setup-v2.zip`. NOT inside the repo — kept outside to avoid accidental commits.

---

## 5. What was deferred (with reasoning)

All deferred items recorded in `tasks/todo.md` under two sections:

### `## Deferred from setup refactor — 2026-05-03` (resolved this session)

8 items, ALL marked `[x] [status:resolved]`. These were initially deferred from the first round of refactor work but addressed inline in subsequent rounds. Each carries a per-item resolution note pointing at where the work landed:

1. Migrate KNOWLEDGE.md "Decision" entries to ADRs → 5 ADRs written.
2. Section-anchor architecture.md → 54 anchors added.
3. Build context-pack-loader skill → agent at `.claude/agents/context-pack-loader.md`.
4. Slim spec-reviewer.md → 70 lines extracted to references/.
5. Archive sweep of tasks/todo.md → 9 sections moved.
6. Archive sweep of docs/ → triage report; 0 eligible after re-verification.
7. Add codebase-explainer agent → done.
8. Wire spec-reviewer staleness check → done.

### `## Deferred from setup audit — 2026-05-03` (NOT resolved — for future sessions)

6 items, all `[ ] [status:open]`. Surfaced during the pre-propagation audit but too risky/large for the current session:

1. **Extract shared boilerplate from `chatgpt-pr-review.md` (976 lines) and `chatgpt-spec-review.md` (667 lines)** to `references/chatgpt-review-protocol.md`. Both files have IDENTICAL 7-section structure; ~30-40% shared content. Saves ~400 tokens per session when either runs. **Risk:** breaking either agent's flow if extraction over-merges. Test by running each on a real PR/spec after extraction.

2. **Move domain-specific subsystem sections out of `architecture.md`** to `architecture/<domain>.md` files. IEE (423 lines), Playbooks (299 lines), ClientPulse Intervention Pipeline (190 lines), Scraping Engine (150 lines), Run Continuity (124 lines). Saves ~1,200 tokens always-loaded. **Risk:** breaks every agent that loads architecture.md until their context-loading instructions are updated. Better done AFTER context-pack-loader is wired to all agents.

3. **Wire the agent fleet to use context packs by default.** Currently `context-pack-loader` is operator-invoked. Most agents still load full architecture.md. Need to edit each agent's Context Loading block. **Depends on item #2 landing first.**

4. **Add a `validate-setup` skill** that re-checks framework health after drift. ADAPT.md does this once; nothing keeps doing it. Steps: read every agent / context pack / hook, confirm references resolve, emit health report.

5. **Quarterly KNOWLEDGE.md grouping pass** as an agent. The size-bound policy is aspirational without an agent to enforce it.

6. **Backfill `Status:` headers across the existing 84 specs in `docs/`.** The convention added this session is forward-only. Without backfill, future archive sweeps still produce 0 candidates.

---

## 6. Files inventory — modified + created + moved

Current `git status` (uncommitted as of handoff):

### Modified

```
M  .claude/agents/architect.md
M  .claude/agents/spec-reviewer.md
M  CLAUDE.md
M  KNOWLEDGE.md
M  architecture.md
M  docs/doc-sync.md
M  docs/frontend-design-principles.md
M  docs/spec-authoring-checklist.md
M  docs/spec-context.md
M  tasks/todo.md
```

### Renamed

```
R  quality-checker-gpt.md → docs/_archive/quality-checker-gpt.md
```

### New (untracked)

```
.claude/CHANGELOG.md
.claude/FRAMEWORK_VERSION
.claude/agents/codebase-explainer.md
.claude/agents/context-pack-loader.md
.claude/agents/hotfix.md
docs/context-packs/
  README.md, debug.md, handover.md, implement.md, minimal.md, review.md
docs/decisions/
  README.md, _template.md, 0001-mixed-mode-review-agents.md,
  0002-interactive-vs-walkaway-review-agents.md,
  0003-workspace-identity-canonical-pattern.md,
  0004-geo-skills-as-methodology-skills.md,
  0005-risk-class-split-rollout-pattern.md
docs/frontend-design-examples.md
references/
  test-gate-policy.md, spec-review-directional-signals.md
tasks/builds/claude-code-framework-v2/
  handoff.md (this file)
tasks/docs-archive-triage-2026-05-03.md
tasks/todo-archive/
  2026-Q2.md
```

Outside the repo:
```
~/portable-claude-setup-v2.zip   (250-254 KB, 76 files)
/tmp/portable-claude-setup/      (staging directory, source for the zip)
```

---

## 7. Audit findings + actions taken

The pre-propagation audit found:

- **6,046 lines always-loaded** across CLAUDE.md (393) + architecture.md (3,542) + DEVELOPMENT_GUIDELINES.md (256) + KNOWLEDGE.md (1,855). Per-session token cost.
- **15 of 19 agents load architecture.md by default.** Primary token bloat. Mitigation shipped (context-pack-loader); full wiring deferred (audit item #3).
- **chatgpt-pr-review.md is 976 lines, chatgpt-spec-review.md is 667 lines, both have identical 7-section structure.** Dedup opportunity. Deferred (audit item #1).
- **architecture.md has 5 sections totaling 1,186 lines** that are domain-specific (IEE, Playbooks, etc.). Always-loaded but only relevant when working on those domains. Deferred (audit item #2).
- **KNOWLEDGE.md at 1,855 lines** approaching the 3,000-line "noise" threshold within ~6 months. Mitigation shipped (size-bound policy in preamble); enforcement deferred (audit item #5).
- **0 docs eligible for automated archive** despite 84 files in `docs/`. The cross-reference graph is too dense; explicit retirement signals don't exist. Mitigation shipped (Status: header convention); backfill deferred (audit item #6).
- **No framework version tracking.** Mitigation shipped (FRAMEWORK_VERSION + CHANGELOG.md).
- **No agent lifecycle protocol.** Mitigation shipped (CLAUDE.md § Agent lifecycle).
- **Frontend-design-principles.md mixed durable rules with origin-project worked examples.** Mitigation shipped (split into two files).

---

## 8. Working tree state at handoff

Branch: `claude/evaluate-summonaikit-B89k3`. Not yet committed. Stop hook has been firing each turn telling the operator to commit and push.

### Suggested commit (one focused commit)

```
chore(setup): claude-code framework v2 — ADRs, context packs, hotfix, anchors, archives, codebase-explainer

- Add docs/decisions/ ADR convention + 5 ADRs extracted from KNOWLEDGE.md
- Add docs/context-packs/ + context-pack-loader agent (54 anchors in architecture.md)
- Add hotfix agent for time-critical fixes
- Add codebase-explainer agent for human onboarding
- Add references/test-gate-policy.md + spec-review-directional-signals.md (dedup boilerplate)
- Add Status: header convention to spec-authoring-checklist § 11
- Wire spec-reviewer to enforce spec-context.md staleness
- Archive resolved sections from tasks/todo.md to tasks/todo-archive/2026-Q2.md
- Archive quality-checker-gpt.md to docs/_archive/
- Slim spec-reviewer.md (575 → 509 lines)
- Split frontend-design-principles.md (durable rules) from frontend-design-examples.md (origin examples)
- Add .claude/FRAMEWORK_VERSION + .claude/CHANGELOG.md (cross-repo drift detection)
- Add CLAUDE.md § Agent lifecycle (add/retire protocol)
- Add KNOWLEDGE.md size-bound policy
- Cross-link replit.md from CLAUDE.md
```

### Two-commit alternative (if reviewer wants smaller chunks)

**Commit 1 — internal framework refactor:**
```
chore(setup): internal framework refactor — agents, ADRs, context packs, archives
```
Covers everything in `automation-v1/`.

**Commit 2 — portable zip artifact:**
The zip itself isn't tracked in git (it sits at `~/portable-claude-setup-v2.zip`). No second commit needed unless you choose to commit the zip into the repo (not recommended — see CLAUDE.md user prefs about generated artifacts).

### What NOT to commit

- `~/portable-claude-setup-v2.zip` — generated artifact; lives outside the repo deliberately.
- `/tmp/portable-claude-setup/` — staging directory used to build the zip; regenerate on demand.

---

## 9. Open questions for next session

None blocking. The audit pass surfaced 6 deferred items (see § 5) but they're all queued in `tasks/todo.md` with sufficient context for a future session to pick up without re-deriving.

If the next session wants to make immediate progress on the deferred queue, the highest-leverage items are:

1. **Audit item #1 (chatgpt-pr-review + chatgpt-spec-review dedup)** — concrete, mechanical, ~400-token savings per session. Risk is contained because the dedup target (`references/chatgpt-review-protocol.md`) is a NEW file; rollback is trivial.

2. **Audit item #4 (validate-setup skill)** — small new agent. Provides ongoing health-check after drift. Useful as the framework propagates.

The HIGH-cost deferred items (architecture.md domain-split, full agent fleet wiring to packs) need their own focused session. Don't squeeze them into a multi-purpose session.

---

## 10. Resume instructions for the new session

In a new VS Code Claude Code session on this branch:

### Step 1 — Confirm context

```
You're picking up the claude-code-framework-v2 refactor.
Read tasks/builds/claude-code-framework-v2/handoff.md in full.
Then read tasks/todo.md, specifically the two sections:
  - "## Deferred from setup refactor — 2026-05-03" (resolved, FYI only)
  - "## Deferred from setup audit — 2026-05-03" (open, pick from here)
Confirm you understand the state before suggesting next steps.
```

### Step 2 — Decide on the commit

Stop hook is firing. The operator's options:
- Commit everything in one shot (suggested commit message in § 8 above).
- Two commits if cleaner review boundary needed.
- Leave uncommitted and continue working — but stop hook will keep firing.

Recommended: **commit before doing more framework work.** Otherwise the working tree gets messier and harder to bisect if anything regresses.

### Step 3 — Pick a deferred item or new direction

If continuing the framework refactor:
- Pick from the "Deferred from setup audit" section in `tasks/todo.md`.
- The chatgpt-review dedup (audit item #1) is the safest next step.

If propagating to other repos:
- The portable zip at `~/portable-claude-setup-v2.zip` is the artifact.
- ADAPT.md inside the zip is the master prompt.
- Open Claude Code in the new repo on Opus, drop the zip contents in, paste ADAPT.md § 4 prompt with `Profile: STANDARD` (or MINIMAL/FULL).

If switching context entirely:
- Reset `tasks/current-focus.md` to `NONE`.
- Run `triage-agent` if there are pending ideas.

---

## 11. Useful commands for the next session

### Verify the framework state

```bash
# Check framework version
cat .claude/FRAMEWORK_VERSION

# Confirm all agent files are valid markdown with frontmatter
for f in .claude/agents/*.md; do
  head -1 "$f" | grep -q '^---$' || echo "MISSING FRONTMATTER: $f"
done

# Count agents per profile
ls .claude/agents/*.md | wc -l   # should be 19

# Confirm hook count
ls .claude/hooks/*.{js,sh} | wc -l   # should be 5 (3 portable + 2 project-specific)

# Verify architecture.md anchors
grep -c '<a id=' architecture.md   # should be 54
```

### Resume the deferred queue

```bash
# Show all open audit items
grep -A 5 'origin:setup-audit:2026-05-03' tasks/todo.md | head -50

# Count uncommitted changes from this session
git status --short | wc -l
```

### Rebuild the portable zip (if it changed)

```bash
# The staging directory is at /tmp/portable-claude-setup/
# Recreate from internal repo if it was lost:
rm -rf /tmp/portable-claude-setup && mkdir -p /tmp/portable-claude-setup
# Then re-run the porting commands from the session log, or
# regenerate from scratch using ADAPT.md as the source of truth.

# Once /tmp/portable-claude-setup/ is populated:
cd /tmp && rm -f portable-claude-setup.zip
zip -rq portable-claude-setup.zip portable-claude-setup
mv portable-claude-setup.zip ~/portable-claude-setup-v2.zip
```

### Verify a deferred audit item is still relevant

```bash
# Item #1: confirm both ChatGPT review files are still big and structurally similar
wc -l .claude/agents/chatgpt-pr-review.md .claude/agents/chatgpt-spec-review.md
diff <(grep '^## ' .claude/agents/chatgpt-pr-review.md) \
     <(grep '^## ' .claude/agents/chatgpt-spec-review.md)

# Item #2: confirm architecture.md still has the heavy domain sections
python3 -c "
from pathlib import Path
content = Path('architecture.md').read_text()
sections = []
current_h, current_s = None, 0
for i, line in enumerate(content.split('\n')):
    if line.startswith('## '):
        if current_h: sections.append((current_h, i - current_s))
        current_h = line[3:]; current_s = i
sections.sort(key=lambda x: -x[1])
for h, n in sections[:10]: print(f'{n:5d}  {h[:70]}')
"
```

---

**End of handoff.** Next session: read this file, confirm context, then pick a direction.

