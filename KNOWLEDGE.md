# Project Knowledge Base

Append-only register of patterns, decisions, and gotchas discovered during development.
Read this at the start of every session. Never edit or remove existing entries — only append.

---

## How to Use

### When to write (proactively, not just on failure)
- You discover a non-obvious codebase pattern
- You make an architectural decision during implementation
- You find a gotcha that would trip up a future session
- You learn something about how a library/tool behaves in this project
- The user corrects you (always capture the correction)

### Entry format

```
### [YYYY-MM-DD] [Category] — [Short title]

[1-3 sentences. Be specific. Include file paths and function names where relevant.]
```

### Categories
- **Pattern** — how something works in this codebase
- **Decision** — why we chose X over Y
- **Gotcha** — non-obvious trap or edge case
- **Correction** — user corrected a wrong assumption
- **Convention** — team/project convention not documented elsewhere

---

## Entries

### 2026-04-04 Decision — Injected middleware messages use role: 'user' not role: 'system'

Anthropic's Messages API only supports `system` as the top-level parameter, not as mid-conversation messages. Context pressure warnings are injected as `role: 'user'` with a `[SYSTEM]` prefix. This is the correct pattern — `role: 'system'` inside the messages array would cause an API error.

### 2026-04-04 Pattern — Persist execution phase to agentRuns for observability

The agentic loop already computes `phase` ('planning' | 'execution' | 'synthesis') per iteration in `agentExecutionService.ts` (line ~940). Consider persisting this to the `agent_runs` row for debugging and post-mortem analysis. Deferred to next sprint — would require a schema change.

### 2026-04-05 Decision — Strategic research: build sequence after core testing

Completed competitive analysis (Automation OS vs Polsia.com) and broader strategic research (competitors, proactive autonomy, marketing skills, onboarding, ROI dashboards, voice AI). Key findings and build priorities documented in `tasks/compare-polsia.md`. Research session: https://claude.ai/chat/a1947df8-4546-4cbb-9d8e-65c542b5f40c

**Pre-testing build priorities (Bucket 1):**
1. Morning Briefing skill — read-only orchestrator evaluation cycle, validates agent quality with zero risk (~1 week)
2. Agency Blueprint Wizard — template-based workspace setup using existing `boardTemplates`/`agentTemplates`/`hierarchyTemplates` schemas (~1 week)
3. Baseline KPI capture during onboarding — enables ROI measurement later (2-3 days)

**Post-testing priorities (Bucket 2):** Proactive agent modes (Observer→Advisor→Operator→Autonomous), SEO agent skills, white-labeled ROI dashboards.

**Deferred (Bucket 3):** Voice AI (Vapi/Retell), paid ads skills, cold email, MCP protocol, agent marketplace.

Core platform testing must validate existing skills, three-tier agents, heartbeat scheduling, process execution, and HITL before adding proactive autonomy.

### 2026-04-13 Pattern — Capabilities registry structure for product + GTM documentation

`docs/capabilities.md` is the single source of truth for what the platform can do. Structure that works well across all audiences:

1. **Core Value Proposition** — 3-4 bullets anchoring the system before any detail
2. **Replaces / Consolidates** — three-column table (replaced / with / why it's better); highest leverage section for sales conversations
3. **Product Capabilities** — benefit-oriented, not config-oriented; one paragraph + 3-5 bullets max per section; deep detail stays in `architecture.md`
4. **Agency Capabilities** — Outcome / Trigger / Deliverable table per capability; add contrast ("not assembled manually") to differentiate from generic SaaS language; no skill references (that's triple representation)
5. **Skills Reference** — flat table with Type (LLM/Deterministic/Hybrid) and Gate (HITL/Universal/auto) columns; legend at top
6. **Integrations Reference** — tables by category (external services, engines, data sources, channels, MCP)

Update rule: update `capabilities.md` in the same commit as any feature or skill change. This is enforced via CLAUDE.md "Key files per domain" table. A CI guard script is a deferred follow-up task.

### 2026-04-13 Decision — GEO skills implemented as methodology skills, not intelligence skills

GEO (Generative Engine Optimisation) skills (`audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare`) are registered as methodology skills in the action registry and use `executeMethodologySkill()` in the skill handler. This means the LLM fills in a structured template using the methodology instructions — there is no deterministic handler that does the analysis. This is the correct pattern because GEO analysis requires LLM reasoning over page content, not deterministic computation. The `geoAuditService.ts` stores results after the agent produces them; it does not compute scores itself.

### 2026-04-13 Decision — MemPalace benchmarks debunked; anda-hippocampus shortlisted for world model

MemPalace (github.com/MemPalace/mempalace) claimed 96.6% LongMemEval / 100% LoCoMo. Community debunked within 24h: LoCoMo 100% was meaningless (top-k exceeded corpus), AAAK "30x lossless compression" is actually lossy with >10% accuracy drop, palace structure contributed minimally (vanilla ChromaDB did the work), honest independent BEAM 100K score is 49%. Repo is AI-generated stubs masquerading as a product. Status: WATCH only, no integration. Retrieval patterns we extracted (query sanitization, temporal validity, dedup, hierarchical metadata) remain valid — they don't depend on MemPalace. For Brain's world model: week 1 uses `beliefs.json` via AgentOS persistence; next phase shortlists anda-hippocampus (ldclabs) for graph-native memory with sleep consolidation and contradiction detection via state evolution. See `docs/oss-intelligence-analysis.md` post-mortem section.

### 2026-04-16 Correction — capabilities.md must use marketing language, never internal technical terms

When updating `docs/capabilities.md`, ALWAYS write in end-user / sales / marketing language. The editorial rules in CLAUDE.md (rule 3) explicitly say: "Write for end-users, agency owners, and buyers — not engineers. Avoid internal technical identifiers." This applies to ALL updates, not just provider-name scrubbing. Specific violations to avoid: referencing implementation patterns by their engineering names (e.g. "canonical-hash idempotency", "dual-bucket boundary tolerance", "WebSocket-first", "eviction metrics", "adaptive polling backstop"). Instead, describe the USER BENEFIT: "exactly-once execution", "real-time streaming", "usage guardrails", "instant feedback". If you wouldn't say it on a sales call, don't write it in capabilities.md.

### 2026-04-13 Pattern — GEO audit score storage uses JSONB for dimension breakdown

`geo_audits` table stores `dimension_scores` as JSONB array of `{dimension, score, weight, findings, recommendations}` and `platform_readiness` as JSONB array. This allows flexible per-dimension storage without needing separate tables for each score type. The `weights_snapshot` column captures the weights used at audit time so historical scores remain reproducible even if default weights change later.

### 2026-04-17 Gotcha — Rebase with merge conflicts can leave duplicate code visible in PR diff

When a rebase involves merge conflicts in a heavily-edited file, the resolved file can look clean locally while the CUMULATIVE diff against main (what GitHub shows in the PR) reveals old+new versions of a block coexisting — because the fix added the new line without removing the old one during conflict resolution. `git show origin/<branch>:file` shows current HEAD (may look clean), while `git diff main...HEAD -- <file>` shows the cumulative diff that reviewers actually see. Always run `git diff main...HEAD -- <changed-file>` after any rebase that involved conflicts to verify what GitHub will show.

### 2026-04-17 Correction — Verify reviewer feedback against the PR diff perspective, not just the local file

During the MCP tool invocations PR, a reviewer flagged a `const durationMs` shadowing bug multiple rounds. Each time, reading the local file and `git show origin/...` showed clean code, so the feedback was dismissed. The actual issue was that intermediate rebase states had introduced the bug into the PR's cumulative diff, even though current HEAD was clean. Rule: if a reviewer repeatedly flags the same issue and the local file looks correct, run `git diff main...HEAD -- <file>` before dismissing. If the cumulative diff is also clean, the reviewer is misreading diff format markers — confirm and explain.

### 2026-04-17 Gotcha — GitHub unified diff format is commonly misread as "both lines present"

A reviewer seeing the GitHub PR diff may interpret:
```diff
-      const durationMs = Date.now() - callStart;
+      durationMs = Date.now() - callStart;
```
as both lines existing in the final file, when in fact `-` means REMOVED and `+` means ADDED — only the `+` line exists after the change. When a reviewer flags a bug that is visibly "fixed" in the diff (old bad line on `-`, new good line on `+`), the code is correct and the reviewer is misreading the diff format. Confirm by reading the actual file or `git show origin/<branch>:file`.

### 2026-04-18 Correction — "Execute the prompt" means invoke the pipeline, not critique the prompt

When the user hands over a build prompt they authored (e.g. the ClientPulse build prompt) and says "use this in a new session," the correct reading is that the prompt IS the instruction — the next step is to execute it, not to suggest tweaks or ask for confirmation. When the user then explicitly says "I want you to EXECUTE the prompt," the earlier hedge ("safe to paste into a fresh session") was already the wrong posture. Rule: if the user provides a self-contained build prompt and tags it as a Major task per CLAUDE.md, invoke `feature-coordinator` immediately. Do not offer "two small tweaks worth considering" unless the user asks for review of the prompt itself.

### 2026-04-19 Correction — Don't invoke dual-reviewer from within this environment

When the user followed up a pr-reviewer pass by saying "we are running dual-reviewer locally," they meant dual-reviewer cannot run from within the Claude Code session here: the Codex CLI (`/opt/node22/bin/codex`) is installed but reports "Not logged in," no `OPENAI_API_KEY` is set, and `~/.codex/` does not exist. Launching the `dual-reviewer` subagent causes it to fall back to a manual senior-engineer review (duplicating what `pr-reviewer` already produced) rather than a real Codex round. Rule: after `pr-reviewer` completes on this machine, stop and hand off to the user for local `dual-reviewer`; do not auto-chain into it.
