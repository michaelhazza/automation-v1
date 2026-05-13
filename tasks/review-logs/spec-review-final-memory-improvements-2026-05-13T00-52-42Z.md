# Spec Review Final Report — memory-improvements

**Spec:** `docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`
**Spec commit at start:** untracked (newly authored)
**Spec commit at finish:** `f0dbeb4e` (local; push blocked by SSL cert — see note)
**Spec-context commit:** `62497257`
**Iterations run:** 1 of MAX_ITERATIONS=5
**Exit condition:** codex-found-nothing (REVIEW_GAP — Codex CLI unable to produce review prose on this Windows host; rubric pass completed independently)
**Verdict:** READY_FOR_BUILD (subject to ChatGPT-spec-review)

## Verdict rationale

Spec is mechanically tight against the rubric. Twelve mechanical fixes applied; one cosmetic finding rejected; zero directional or ambiguous findings. The lifetime cap of 5 reserves 4 iterations for follow-up if Codex becomes available later or if ChatGPT-spec-review surfaces new mechanical work.

The caller flagged this exact contingency in the invocation: "If Codex CLI is unavailable in this environment ... exit cleanly with REVIEW_GAP and a note so the coordinator can continue to chatgpt-spec-review." Done.

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 0 (REVIEW_GAP) | 18 (12 actionable, 5 verification-only, 1 cosmetic-rejected) | 12 | 1 | 0 | 0 | none |

## Mechanical changes applied

Grouped by spec section:

### §1.2 Non-goals, §2 Framing
- No edits required. Framing inheritance from `docs/spec-context.md` verified clean.

### §3.5 B1 denominator invariant, §3.6 not-measured invariant
- Added explicit NOT NULL DEFAULT [] note on `cited_entry_ids` and `applied_memory_block_*` columns.
- Documented the NULL-discriminator asymmetry: applies to entry-side only, not block-side.
- Added "no block-side migration" guard so the build phase doesn't accidentally try to migrate `applied_memory_block_ids`.

### §4 Phase 1 (A — lineage), §5.1 New files, §7.1 RLS, §12.3 Verification
- Renumbered migration `0330` → `0333` (collision: `0330_external_source_triggers` already exists).
- Added `CREATE INDEX idx_mbvs_source_entry_hash` so the reverse-lineage query is index-covered.
- Pinned route guard `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` (verified against `server/routes/memoryBlocks.ts:46-49`).

### §4 Phase 2 (B1 — substrate), §5.1 New files, §5.2 Modified files
- Renumbered migration `0331` → `0334` (collision: `0331_system_agents_home_widget` already exists).
- Pinned write-site anchor `agentExecutionService.ts:1349-1356` (immediately after `memoryWithTracking.injectedEntries` binds).

### §4 Phase 4 (B2 — dashboard), §5.1 New files, §6.3, §7.3, §8.1, §13.7
- Aligned route shape to `GET /api/orgs/:orgId/usage/memory-utility` (existing convention: `server/routes/llmUsage.ts:27-30`).
- Added explicit guard `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)`.

### §5.1 Migrations
- Reworded `.down.sql` rationale: "matching `.down.sql` per the repo convention" (replaces opaque reference to finalisation-coordinator).

### §8.2 Cache boundary
- Corrected `agentExecutionService.ts` cache-boundary line anchors: `1254-1257` → `1277/1394`.

### §9.3 Phase-boundary check
- Migration numbers cascaded: `0330`/`0331` → `0333`/`0334`.

### §11 Self-consistency
- Added iteration-1 audit footnote so future readers know §11 was last asserted pre-review.

### §14.1 Sources tab
- Clarified MemoryBlockDetailPage today renders TWO tabs (Version History, Diff vs Canonical) at lines 123-138. The file-header comment lists three but only two are rendered. New tab will be the third.

### §14.2 Memory Utility tab
- Removed "build phase confirms current labels" hedge — labels at `UsagePage.tsx:220-225` verified at iteration 1.

### §15 Open questions
- Resolved §15.3 (write-site anchor pinned).
- Resolved §15.4 (permission key pinned).
- Resolved §15.6 (reverse-lineage performance — hash index added).
- §15.1, §15.2, §15.5, §15.7 remain as legitimate build-phase decisions.

### Frontmatter
- `Status: draft` → `Status: reviewing`.
- `Last updated:` annotated with `(spec-reviewer iteration 1)`.

## Rejected findings

- **R15 — "Brief" vs "brief" casing inconsistency.** Cosmetic; not the kind of tightening this loop is for. The iteration cap is a finite resource and rejection of low-value findings preserves it for genuine issues.

## Directional and ambiguous findings (autonomously decided)

None. No findings triggered Step 7. All 12 actionable findings were unambiguously mechanical.

## Codex output gap

Codex CLI v0.118.0 on this Windows host produced no review findings across six attempts (five model variants, including with the spec piped in via stdin). The full failure trace is in `tasks/review-logs/spec-review-log-memory-improvements-1-2026-05-13T00-52-42Z.md § Codex run notes`. Raw attempts are retained at `tasks/review-logs/.codex-iter1-raw-*.txt` for the coordinator's audit.

This means **the only external review pass for this spec is the upcoming `chatgpt-spec-review`** session. The coordinator should treat the chatgpt-spec-review output as the only external classification check on this spec and act on it accordingly.

## Push status

`git commit` succeeded locally (commit `f0dbeb4e`). `git push` failed with:

```
fatal: unable to access 'https://github.com/michaelhazza/automation-v1.git/': SSL certificate OpenSSL verify result: unable to get local issuer certificate (20)
```

This is the same SSL-cert issue the caller flagged for this environment. The iteration-1 commit is on the local branch `claude/add-memvid-integration-ehAOr` only. The user (or a follow-up session that can use a configured git environment) needs to push manually before chatgpt-spec-review can read the updated spec from the remote.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric. However:

- **Codex did not produce findings.** ChatGPT-spec-review will be the only external pass. If it surfaces directional concerns, this lifetime cap reserves four iterations for response.
- The review did not re-verify the framing assumptions. The framing in §2 inherits verbatim from `docs/spec-context.md`; the staleness check is GREEN (2 days old; well under the 60-day threshold).
- The review did not prescribe what to build first. Phase sequencing (§9) was authored with B1 → D operational dependency, and the rubric pass did not change that.

**Recommended next step:** push the iteration-1 commit to the remote, then run `chatgpt-spec-review` against the updated spec.
