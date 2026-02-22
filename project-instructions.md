# SaaS Product Framework - Project Instructions

## What This Project Is

A **unified specification framework** transforming executive briefs into production-ready SaaS applications. Constitutional specification generator produces structured documentation consumed by **Claude Code** to generate deployable apps on **Replit**.

**Important:** Australian English throughout (organisations not organizations).

## Core Problem

AI code generation typically achieves 60-70% completion. **Prevention-first specification design** closes the gap — upstream spec quality ensures downstream generation succeeds completely.

## Pipeline Architecture (How Everything Connects)

The framework operates as a **four-stage relay**. Each stage has a specific executor, input, and output. Outputs flow forward only.

```
Stage 1: Specification Generation
  Executor:  Claude (chat interface — this project)
  Input:     Executive IDEA brief (pasted by user)
  Process:   spec-generator-unified.md
  Output:    10 specification artifacts under docs/
  Delivery:  User downloads files from Claude chat

Stage 2: Application Implementation
  Executor:  Claude Code (agentic coding tool)
  Input:     10 docs/ artifacts + master-build-prompt-unified.md
  Process:   Claude Code reads specs, generates full codebase
  Output:    Complete working SaaS repo (server/, client/, scripts/, etc.)
  Note:      Claude Code generates ALL implementation code including
             run-all-gates.sh, run-all-qa-tests.sh, drizzle.config.ts,
             and every file needed for a working application.
  Delivery:  Code committed to Git repository

Stage 3: Replit Deployment
  Executor:  Replit AI agent (inside Replit IDE)
  Input:     Git repo imported into Replit project
  Process:   replit-environment-setup-unified.md
  Output:    Running application in Replit environment
  Steps:     Validate docs/ exist, configure Replit, set Secrets,
             install deps, run migrations, extract & run gates/QA,
             build and start application

Stage 4: Quality Review (Optional)
  Executor:  Claude Code or separate GPT
  Input:     Running codebase + docs/ artifacts
  Process:   quality-checker-gpt.md (only if QUALITY_CHECKER_ENABLED: true)
  Output:    Quality report + automated fixes
```

**Critical handoff points:**
- Stage 1 → 2: User downloads 10 docs/ files from Claude chat, places them in Claude Code project root under docs/
- Stage 2 → 3: Claude Code commits completed repo to Git; user imports Git repo into Replit
- Stage 3 runs inside Replit only — it is NOT part of the Claude Code build

## Governing Principles

1. **Application-Agnostic**: Every component must work for any SaaS type. Never embed domain-specific logic.
2. **Specification Quality Over Speed**: Precision over marketing language. Explicit contracts over implicit assumptions.
3. **Prevention-First**: Constitutional validation requires 100% specification quality before code generation.
4. **File-Linked Dependencies**: Documents list dependencies by filename only — no version pins. Version numbers for evolution tracking; Git commits provide snapshots.
5. **Framework-Only Edits**: Only the 4 files in Framework Document Registry may be modified. Specification output files are never edited directly — trace output issues to the generator prompt and fix upstream.

**Canonical filenames**: Framework files use the `-unified` suffix (e.g. `spec-generator-unified.md`). Files may be shared with shorter transport names — rename to canonical form before committing to the repo.

**This file is a human operator guide.** It is NOT a Claude Code build input. The sole build input for Stage 2 is master-build-prompt-unified.md.

## Framework Document Registry

| # | Document | Filename | Linked Documents |
|---|----------|----------|------------------|
| 1 | Specification Generator | spec-generator-unified.md | None (root generator) |
| 2 | Master Build Prompt | master-build-prompt-unified.md | spec-generator-unified.md, quality-checker-gpt.md |
| 3 | Quality Checker GPT | quality-checker-gpt.md | spec-generator-unified.md, master-build-prompt-unified.md |
| 4 | Replit Environment Setup | replit-environment-setup-unified.md | spec-generator-unified.md, master-build-prompt-unified.md |

## Specification Output Artifacts (Stage 1 Output)

The Specification Generator produces exactly 10 artifacts under docs/:

1. **docs/scope-manifest.json** — Product definition with entities, roles, relationships
2. **docs/env-manifest.json** — Environment variable specifications
3. **docs/data-relationships.json** — Database schema and relationships
4. **docs/service-contracts.json** — API endpoint contracts
5. **docs/ui-api-deps.json** — UI page specifications and API dependencies
6. **docs/gate-scripts-reference.md** — Quality gate script definitions
7. **docs/gate-splitter.sh** — Standalone gate script extraction utility
8. **docs/qa-scripts-reference.md** — QA test script definitions
9. **docs/qa-splitter.sh** — Standalone QA script extraction utility
10. **docs/architecture-notes.md** — Technical architecture documentation

These are NEVER edited directly — regenerate by improving the specification generator.

## Document Version Header Standard

Every framework document has a Version Reference block after the title listing This Document (filename/version) and Linked Documents. Version numbers appear in exactly two places: the This Document line and VERSION HISTORY. Body text references dependencies by filename only.

## Target Environment

Replit: React 18 + Vite, Express.js/TypeScript, PostgreSQL, Drizzle ORM.

## Conversation Defaults

Assume framework context. Default to application-agnostic (specific apps are test cases). Prioritise precision — flag vague language and implicit assumptions. Track version deltas and downstream impacts when updating files. Version numbers only in This Document line and VERSION HISTORY. Translate output feedback into framework file improvements upstream.
## Framework Update Workflow

When feedback surfaces issues — in framework files or specification output — you **MUST auto-implement immediately**: triage, state what is accepted or rejected, then apply fixes to **framework files only**. **NEVER ask permission. NEVER wait for confirmation. NEVER stop to ask if ready.** Trace every finding to responsible framework file and fix upstream.

**Process (execute immediately):**

1. **Triage.** Accept items improving spec quality, reject noise. Brief rationale. When fix requires a design decision, pick the option best supported by existing patterns and implement immediately.
2. **Guard application-agnosticism.** Generalise improvements for any SaaS type.
3. **Implement upstream.** Apply changes to responsible framework file(s) — never specification output files.
4. **Output affected framework files.** Complete downloadable files — no partial diffs.

**FORBIDDEN RESPONSES:** "Ready to implement?", "Should I proceed?", "Would you like me to...", or any permission-seeking language.

**Hold-off override:** Only if user explicitly says "don't make changes yet" — then stop after triage and wait.

## Working Standards

- Self-contained prompts with defined inputs, outputs, verification commands.
- Write for machine consumption first — Claude Code is primary downstream reader.
- ASCII/UTF-8 only — no smart quotes or special Unicode.
- Version numbers only in This Document line and VERSION HISTORY.
- Build Prompt exposes Quality Checker enabled flag, defaulting to off.
- Linked Documents entries list filenames only — no version numbers.

## Scope

**In scope**: Framework file design (4 registry files), specification output quality, constitutional enforcement, verification tooling, framework testing, cross-file consistency.

**Out of scope**: Running spec generator against specific briefs, modifying Claude Code, Replit platform config, editing specification output artifacts directly.