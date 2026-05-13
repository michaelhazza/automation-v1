# Spec Review Iteration 1 — memory-improvements

**Spec:** `docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`
**Iteration:** 1 of MAX_ITERATIONS=5
**Started:** 2026-05-13T00:52:42Z
**Codex CLI status:** REVIEW_GAP (see notes).

## Codex run notes

Codex CLI (v0.118.0) authenticated to ChatGPT account; Windows sandbox environment incompatible:

1. Default model `gpt-5.5` rejected with "requires a newer version of Codex".
2. `gpt-5`, `gpt-5.1`, `gpt-5.1-codex` all rejected: "not supported when using Codex with a ChatGPT account".
3. With `gpt-5.4`, every PowerShell read command (`Get-Content`, `Select-String`, `cmd /c findstr`) blocked by `codex_core::tools::router: rejected: blocked by policy`. Inlining the spec via stdin: Codex echoes the input and exits without generating review prose.

Matches caller's prediction (SSL + Windows-sandbox blocking external tools). Proceeding with rubric pass per agent contract.

Raw attempts retained: `.codex-iter1-raw-memory-improvements{,-v3,-v4,-v5,-v6}.txt`, `.codex-iter1-raw-v7.txt`.

## Rubric findings

### Mechanical accepted (auto-apply)

**R1 — Migration number collision.** §4 P1/§4 P2/§5.1. Spec proposes `0330` and `0331`; both taken (`0330_external_source_triggers`, `0331_system_agents_home_widget`, `0332_executive_assistant_seed`). Next free pair: `0333` and `0334`. Renumber.

**R2 — agentExecutionService line range drift.** §8.2. Cited `1254-1257`; verified `stablePrefix` at line 1277, `dynamicSuffix` at line 1394. Correct anchors.

**R3 — cited_entry_ids nullability detail.** §3.5. Spec calls it "jsonb string[]"; actual column is `notNull().default([])`. Add the NOT NULL DEFAULT [] note so the discriminator design's asymmetry between entry side and block side is unambiguous.

**R4 — Permission key under-specified.** §7.1/§15.4. Spec says `requirePermission('memory_block.view')` but the codebase uses `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` (verified `server/routes/memoryBlocks.ts:46-49`). Replace placeholder; remove §15.4 deferral.

**R5 — Usage route shape contradicts existing convention.** §4 P4/§6.3/§7.3. Spec proposes `GET /api/usage/memory-utility?organisation_id=X`. Verified `server/routes/llmUsage.ts:27-30`: convention is `GET /api/orgs/:orgId/usage/<surface>` with `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)`. Rename to `GET /api/orgs/:orgId/usage/memory-utility`.

**R6 — MemoryBlockDetailPage tab count clarification.** §14.1. Spec says "alongside Version History / Diff vs Canonical" (accurate to rendered tabs). The file-header comment lists three tabs but only two are rendered. Add a small parenthetical so the build phase isn't confused by the stale file-header comment.

**R7 — UsagePage tab labels — drop "build phase confirms" hedge.** §14.2. Spec lists "Overview / Agents / Models / Runs / Routing / IEE Execution" hedged with "build phase confirms current labels against the live page". Verified `client/src/pages/UsagePage.tsx:220-225` — those exact labels ARE the current state. Drop the hedge.

**R8 — Open question §15.3 resolvable now.** §15.3/§4 P2. Spec defers "exact `injected_entry_ids` write site". Verified anchor: `agentExecutionService.ts:1349-1356`, immediately after `memoryWithTracking.injectedEntries` is read at line 1356. Pin the line; remove the open question or downgrade to a build-phase consistency check.

**R9 — Down-migration rationale wording.** §5.1. The phrase "per finalisation-coordinator's CI auto-fix patterns" is opaque. Replace with "matching `.down.sql` per the repo convention (every migration in `migrations/` has a sibling .down.sql)".

**R11 — §11 self-consistency footnote.** §11. "No contradictions identified" was the author's pre-review claim. Add a one-line footnote noting that the spec-reviewer iteration-1 mechanical pass touched the spec, so future readers know §11's audit is pre-review.

**R12 — Schema overlap clarity for B1 vs Phase 8 W3c.** §3.5/§3.6. The asymmetry (entry side gets NULL-discriminator; block side keeps NOT NULL DEFAULT []) is load-bearing and currently implicit. Make it explicit so the build phase doesn't try to migrate the block side.

**R16 — Reverse-lineage index missing.** §4 P1 schema. The schema indexes `source_entry_id` (FK column) but the reverse-lineage query in §6.1 groups by `source_entry_id_hash`. Add `idx_mbvs_source_entry_hash` so the reverse query is cheap. Closes §15.6's deferred performance question.

### Mechanical no-op (verification only)

**R10** framing inheritance from spec-context.md verified clean. **R13** rationale.html exists. **R14** §14.3's git-history pointer is informational. **R17** all four mockup files exist. **R18** spec-context.md staleness GREEN.

### Mechanical rejected

**R15** "Brief" vs "brief" cosmetic inconsistency. Rejected: not the kind of tightening this loop is for.

### Directional / ambiguous

None this iteration. All findings are mechanical.

## Counts

- mechanical_accepted: 12 (R1, R2, R3, R4, R5, R6, R7, R8, R9, R11, R12, R16)
- mechanical_rejected: 1 (R15)
- mechanical no-op: 5 (R10, R13, R14, R17, R18)
- directional_or_ambiguous: 0
- Codex findings: 0 (REVIEW_GAP)

## Mechanical fixes applied

Applied in spec; commit hash recorded after Step 8b.
