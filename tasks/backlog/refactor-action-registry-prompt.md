# Refactor prompt — collapse duplication in `server/config/actionRegistry.ts`

**Run this in a fresh branch after PR #277 (`claude/support-ticket-structure-xMcy8`) merges.**

Paste the brief below into a new Claude Code session.

---

## Brief

`server/config/actionRegistry.ts` is ~4500 lines and roughly 90% boilerplate. Every `ACTION_REGISTRY` entry repeats the same scaffolding: `actionType` (which always equals the object key), `actionCategory: 'worker' as const`, `topics: [...]`, retry policy shapes that fall into 3-4 standard buckets, MCP annotations that follow predictable patterns from `readOnlyHint`/`isExternal`, and several other fields that are mechanically derivable.

Refactor the file so each action entry expresses only what is *unique* to that action, and shared defaults come from helper factories. Goal is roughly a 50-60% line reduction with zero behaviour change.

## What to do

1. **Read first** before changing anything:
   - `server/config/actionRegistry.ts` end-to-end (the whole 4500 lines)
   - `tasks/builds/synthetos-foundation-refactor/spec.md` §4.2 (Risk Tier rubric — must remain explicit per entry)
   - `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`
   - Every CI gate that reads from this file: `scripts/verify-risk-tier-assigned.ts`, `scripts/verify-runtime-check-coverage.mjs`, `scripts/verify-action-call-allowlist.ts`, and any other `verify-*.{ts,sh,mjs}` that imports `ACTION_REGISTRY`. Grep for `ACTION_REGISTRY` and `actionRegistry`.

2. **Identify the natural duplication clusters.** Likely groups (verify against actual code):
   - Internal canonical reads (`isExternal: false`, `readPath: 'canonical'`, `defaultGateLevel: 'auto'`, `idempotencyStrategy: 'read_only'`, MCP `readOnlyHint: true`)
   - Internal state writes (`isExternal: false`, `readPath: 'none'`, `idempotencyStrategy: 'state_based'`)
   - External provider reads (`isExternal: true`, `readPath: 'liveFetch'`, `idempotencyStrategy: 'read_only'`)
   - External provider writes (`isExternal: true`, `idempotencyStrategy: 'keyed_write'`)
   - Customer-messaging external writes (subset of external writes — Tier 6, `defaultGateLevel: 'review'`)
   - Per-topic groupings (`support.*`, `email.*`, `crm.*` etc.) where `topics` and naming patterns are uniform

3. **Design the factory shape.** Extract helpers like:
   ```ts
   defineCanonicalRead({ slug, description, params, riskTier, payloadFields })
   defineInternalStateWrite({ slug, description, params, riskTier, payloadFields, retry? })
   defineExternalWrite({ slug, description, params, riskTier, defaultGateLevel?, payloadFields, retry?, verify? })
   defineCustomerMessagingWrite({ slug, description, params, payloadFields, verify })
   ```
   Each factory fills in `actionType` (from slug), `actionCategory`, `topics` (passed in once per group), retry defaults, MCP annotations derived from the call site, idempotency strategy. Per-action overrides via optional fields.

4. **Per-domain split** is also worth considering. If the file is still > ~1500 lines after factoring, split by topic into `server/config/actionRegistry/` directory:
   - `actionRegistry/index.ts` — assembles `ACTION_REGISTRY` from domain modules
   - `actionRegistry/types.ts` — `ActionDefinition`, factories, shared types
   - `actionRegistry/support.ts`, `email.ts`, `crm.ts`, `tasks.ts`, `code.ts`, ... — one per topic
   - Single re-export at the original path for backwards compatibility with existing imports.

5. **Hard invariants — refactor must preserve all of these:**
   - Every action retains its existing `riskTier` value exactly. No re-classifications. Cross-check against `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv` after the refactor.
   - Every `verifyNullJustification` and inline `verify` shape stays identical.
   - The "20-most-used external skills carry concrete `verify` shapes inline" rule (see comment near §6.1 trust-layer backfill) still holds.
   - Every CI gate listed in step 1 must still pass.
   - No public API changes — `ACTION_REGISTRY` shape and `ActionDefinition` interface stay exported as-is.
   - The verify gate at `scripts/verify-runtime-check-coverage.mjs` operates on the runtime registry, not source text — keep it green.

6. **Pipeline.** Treat as a Significant task per `CLAUDE.md` §Task Classification:
   - Invoke `architect` first — get a written plan into `tasks/builds/<slug>/plan.md` before touching code.
   - Implement chunk-by-chunk via `superpowers:subagent-driven-development`.
   - After implementation: `pr-reviewer` → `dual-reviewer` (if Codex available) → ChatGPT PR review.
   - Doc-sync: update `architecture.md` if the file path changes (split into directory). Add a KNOWLEDGE.md entry on the duplication-collapse pattern if the factories are reusable elsewhere.

7. **Verification at every step:**
   - After each chunk: `npm run typecheck` clean.
   - After full refactor: re-run `npx tsx scripts/verify-risk-tier-assigned.ts`, `node scripts/verify-runtime-check-coverage.mjs`, `npx tsx scripts/verify-action-call-allowlist.ts` (or whichever the actual filenames are). All green.
   - Diff-test: write a one-shot script that imports both the old and new `ACTION_REGISTRY` (e.g., from a git-stashed copy vs the new code) and asserts deep equality on every entry. The refactor is correct only when this passes.

## Out of scope

- Adding new actions
- Changing existing risk tier assignments
- Changing the `ActionDefinition` interface shape (only the construction pattern changes)
- Renaming any action slugs

## Estimated scope

Significant — multiple files, structural decisions, full review pipeline. Plan first, do not implement directly.
