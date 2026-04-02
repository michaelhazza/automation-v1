# Development Brief: Action Registry Enhancements

**Date:** 2026-04-02  
**Status:** Revised after codebase investigation  
**Origin:** Claw-code architecture analysis (see `tasks/claw-code-deep-dive.md`)

---

## Context

After benchmarking against claw-code's tool spec patterns, we identified 4 potential enhancements to our action registry. We then investigated our actual codebase to determine which (if any) are needed now.

---

## Findings from Codebase Investigation

### 1. Centralized Parameter Schemas — DEFER

**What we proposed:** Replace `payloadFields: string[]` with JSON Schema objects for centralized validation.

**What we found:** Validation is already happening — it's just scattered. Every executor in `skillExecutor.ts` and `devopsAdapter.ts` manually checks required fields inline (`if (!field) return error`). This works. Additionally, skill `.md` files already define rich JSON Schemas in their `input_schema` blocks, which get sent to the LLM as tool definitions via `systemSkillService.ts`.

**The real picture — three sources of truth:**

| Source | What it defines | Used for |
|--------|----------------|----------|
| `actionRegistry.ts` → `payloadFields` | Field names only (no types) | MCP tool catalogue display |
| `server/skills/*.md` → `input_schema` | Full JSON Schema (types, required, enums) | LLM tool definitions |
| `skillExecutor.ts` → inline checks | Ad-hoc `if (!field)` validation | Runtime validation |

These three are disconnected but functional. The LLM gets good schemas (from skill `.md` files). The executor catches bad inputs. The registry's `payloadFields` is the weakest link but it's only used for MCP catalogue display.

**Verdict: DEFER.** This is technical debt, not a bug. Consolidate when we refactor the skill executor or hit actual schema drift bugs. No evidence of LLMs making bad tool calls due to missing schemas — they get the schemas from the `.md` files already.

---

### 2. Per-Agent Tool Scoping — ALREADY BUILT

**What we proposed:** Add `allowedActions` filtering per agent context.

**What we found:** This is already fully implemented:
- `subaccountAgents.allowedSkillSlugs` (JSONB column) stores per-agent tool allowlists
- `toolRestrictionMiddleware` enforces the allowlist before every tool call
- `agentExecutionService.ts` resolves skills in 3 layers (system agent → org → subaccount) and only sends configured skills to the LLM
- `claudeCodeRunner.ts` has its own `DEFAULT_ALLOWED_TOOLS` + `allowedTools` parameter
- Backward-compatible: null/empty allowlist = all tools available

**Verdict: NO WORK NEEDED.** Remove from the brief entirely.

---

### 3. Action Descriptions — DEFER (with one exception)

**What we proposed:** Add a `description` field to each action.

**What we found:** LLMs already get good descriptions from the skill `.md` files via `systemSkillService.ts`. The only place descriptions are bad is the MCP server, which auto-generates them from slugs (`"send email — category: api"`).

**Verdict: DEFER** unless MCP is a near-term priority. If it is, fix MCP descriptions as part of the MCP improvement (item 4 below).

---

### 4. MCP Tool Exposure — BUILD NOW (conditionally)

**What we proposed:** Name normalization + aliases.

**What we actually found:** The MCP problem is bigger than we initially scoped. The MCP server (`mcpServer.ts`) has three active issues:

1. **Untyped parameters** — Every action gets `z.record(z.unknown())` as its schema. MCP clients get zero guidance on what fields to provide.
2. **Auto-generated stub descriptions** — `"send email — category: api"` instead of the rich descriptions from skill `.md` files.
3. **Missing ~40% of skills** — MCP only exposes `ACTION_REGISTRY` entries (~17 actions). But the system has ~30 skills total. Skills like `capture_screenshot`, `write_tests`, `update_task`, `spawn_sub_agents` are invisible to MCP clients.

**Verdict: BUILD NOW — but only if MCP clients are actively being used or planned for Q2.** If MCP is still theoretical, defer everything.

---

### 5. Name Normalization — DEFER

**What we proposed:** Alias map and normalization function.

**What we found:** No evidence of tool-call failures from name mismatches. The skill resolution system uses exact slugs and works fine.

**Verdict: DEFER.** Solve if we see actual evidence of this problem.

---

## Revised Recommendation

| Enhancement | Original Priority | Revised Priority | Rationale |
|------------|-------------------|-----------------|-----------|
| Parameter schemas | HIGH | **DEFER** | Three sources of truth is messy but functional. LLMs already get schemas from skill `.md` files. |
| Per-agent tool scoping | HIGH | **DONE** | Already built via `allowedSkillSlugs` + middleware. |
| Action descriptions | MEDIUM | **DEFER** | Only affects MCP. LLMs get descriptions from skill files. |
| MCP improvements | LOW | **CONDITIONAL** | Real problems exist, but only matter if MCP is actively used. |
| Name normalization | HIGH | **DEFER** | No evidence of actual failures. |

### Decision point

**If MCP is a near-term priority:** The one thing worth building now is fixing `mcpServer.ts` to pull schemas and descriptions from the skill `.md` files instead of the bare action registry. This is a targeted fix (~1 file) rather than a registry-wide refactor.

**If MCP is not a priority:** Defer everything. The internal agent execution path is well-structured and working.

---

## What Changed from the Original Brief

The original brief was written based on patterns observed in claw-code's architecture. After actually investigating our codebase, we found:

1. We overestimated the parameter schema gap — LLMs already get schemas via a different path (skill `.md` files)
2. We proposed building something that already exists (tool scoping)
3. The real gap is narrower than expected — it's specifically MCP tool exposure, not the whole registry
4. The codebase has more structure than the registry alone suggests — the skill system carries the weight
