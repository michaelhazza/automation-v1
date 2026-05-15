# Wave 2 — Hotspot skills audit

**Verdict:** PASS_WITH_DEFERRED
**Scope:** 186 `.md` skill definition files in `server/skills/` ↔ `server/config/actionRegistry/*.ts` registry alignment.
**Branch:** `claude/wave-2-audit-sweep`
**Captured:** 2026-05-15T07-19-34Z
**Mode:** Findings-only.

## Reconnaissance Map

- `server/skills/*.md`: **186** files (185 actionable + 1 README). Slugs in `tasks/audit-logs/skill-slugs.txt`.
- `server/config/actionRegistry/{core,intelligence,agents,methodology,configuration,clientpulse,commerce,support,calendar,slack}.ts`: **103** object-literal keys captured via `^[ ]+[a-z_]+:[ ]+(define|\{)` pattern. Some are non-action sub-fields (`annotations`, `mcp`, `canonical_dictionary`) — true action count ≈ 100. Slugs in `tasks/audit-logs/registry-keys.txt`.
- Concurrent audits: B/C edit code; this audit reads `server/skills/`, `server/config/actionRegistry/` only.

## Pass 1 Findings

| ID | Severity | Confidence | Finding |
|---|---|---|---|
| SK1 | medium | high | **95 skill `.md` files have no matching `actionRegistry` slug.** `comm -23 skill-slugs.txt registry-keys.txt` returns 95 lines (excluding README). Two failure modes: (a) the skill is *expected* to be a methodology/planning skill, registered via a different surface (e.g. `methodology.ts` factory pattern with no top-level literal key), (b) the skill is genuine drift — a `.md` file landed without a registry entry, meaning agents can read the doc but the orchestrator cannot invoke it. Without a one-to-one source-of-truth manifest, both modes look identical from the outside. Examples of likely-orphaned slugs: `analyse_42macro_transcript`, `audit_geo`, `book_meeting`, `capture_screenshot`, `chase_overdue`, `classify_email`, `derive_test_cases`, `discover_prospects`, `draft_ad_copy`, `draft_followup`, `generate_competitor_brief`, `generate_invoice` (full list: `tasks/audit-logs/skill-slugs.txt` minus `registry-keys.txt`). |
| SK2 | medium | medium | **Naming convention drift between skill-file slugs and registry slugs.** Skill files use kebab-case in some areas (`calendar-create-event.md`, `calendar-find-free-slot.md`, `ea-daily-briefing.md`, `ea-home-widget-summary.md`) while the registry uses snake_case (`create_task`, `send_email`). The kebab-case skill files have NO matching snake_case registry entries, meaning the orchestrator's slug resolver (`resolveActionSlug`) must do some translation — but no `actionSlugAliases` source file was located (only `__tests__/actionSlugAliasesPure.test.ts` references the concept). |
| SK3 | low | medium | **Universal skill list (`server/config/universalSkills.ts`) hardcodes 7 slugs.** The file header says "this list must stay in sync" with `ACTION_REGISTRY.isUniversal`. Manual sync — no automated check landed in the file. A skill author who adds `isUniversal: true` to a new registry entry without updating `UNIVERSAL_SKILL_NAMES` will silently degrade the universal-skill filter behaviour. |
| SK4 | low | high | **12 registry "keys" are non-action sub-fields.** Pattern-match captured `annotations`, `mcp`, `canonical_dictionary` (and 9 others) as registry entries when they are actually nested fields inside `ActionDefinition.mcp.annotations`. The true action count from the registry is ~91, not 103. This affects audit accuracy, not behaviour. |
| SK5 | low | medium | **Methodology skills may not be registered at all.** The 95 unmatched `.md` files include many methodology slugs (`analyse_*`, `draft_*`, `derive_test_cases`, `generate_competitor_brief`). If they are pure-LLM prompt scaffolds with no executable handler, they may legitimately have no registry entry — but the framework requires *some* surface for the orchestrator to know they exist. Without a canonical methodology-skill manifest, the orchestrator cannot enumerate them. |

## Prevention Proposals

| ID | Target | Proposal | Closes |
|---|---|---|---|
| PP-SK1 | `gate` | New gate `verify-skill-registry-alignment.sh` — for every `.md` in `server/skills/`, assert (a) corresponding registry entry exists, OR (b) a sibling manifest declares the skill as methodology-only with no executable handler. Currently no gate enforces this. Leverage tier 1. | SK1, SK2, SK5 |
| PP-SK2 | `gate` | Lint rule on `server/config/universalSkills.ts` — assert every slug in `UNIVERSAL_SKILL_NAMES` also has `isUniversal: true` in `ACTION_REGISTRY` (bidirectional check). Leverage tier 1. | SK3 |
| PP-SK3 | `docs/codebase-audit-framework.md` § Module L | Promote the skill ↔ registry alignment check to the Module L canonical checklist (currently it covers visibility but not registry completeness). Leverage tier 2. | SK1 |
| PP-SK4 | `KNOWLEDGE.md` | Pattern entry: a skill `.md` file landing without a registry entry means the doc is searchable but the skill is uninvocable — silent gap with no runtime error. Detection: grep skill-files vs registry-keys, both directions. Leverage tier 3. | SK1 |

## Post-audit actions required

Architectural clarification: where do methodology-only skills (pure-LLM prompt scaffolds) get declared, if not in `ACTION_REGISTRY`? Without a clear answer, SK1 cannot be triaged into "drift" vs "by design".

Findings count: 5 (3 medium, 2 low).
