# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `docs/config-agent-guidelines-spec.md`
**Spec commit:** `7054e4d0a5a11199abf0c705572504be7e444fe2`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-16T01:20:00Z

**Mechanical fixes applied in this iteration** (no action needed):
- C2-1: §3.6 — added demote-path rule; §3.7 stated "nobody via the UI" can delete, but the demote endpoint bypassed that
- C2-3: §8 item 4 — stale `agent_memory_blocks` corrected to `memory_block_attachments` with `permission: 'read'`
- C2-4: §8 item 8 — stale "all six / in staging" corrected to align with updated §3.8 acceptance bar
- R2-1: §4 — added `scripts/run-all-gates.sh` and `server/routes/knowledge.ts` to file inventory
- R2-2: §4 — `server/routes/memoryBlocks.ts` description updated to reflect 5-rule guard scope

---

## Finding 2.1 — Protected block name not reserved on CREATE

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X" (the PROTECTED_BLOCK_NAMES guard scope)
**Source:** Codex run (iteration 2)
**Spec section:** §3.6

### Codex's finding (verbatim)

> The allowlist only protects existing blocks from delete/rename. In a fresh environment before the seeder runs, or after ops removes the row, an AGENTS_EDIT user can still create a normal block named `config-agent-guidelines` via `POST /api/memory-blocks`. Because §3.4 makes the seeder create-if-absent and non-overwriting, it would then treat that user-authored block as the managed guidelines block and never seed the canonical content.

### Tentative recommendation (non-authoritative)

Add a sixth guard rule to §3.6: "**POST** (create) with `name` in `PROTECTED_BLOCK_NAMES` → return `409 Conflict` with `errorCode: 'PROTECTED_MEMORY_BLOCK'`." This closes the squatter window and ensures the name is reserved for the seeder from the first deploy.

### Reasoning

The bypass is real: a user creates a block named `config-agent-guidelines` before the seeder runs, the seeder's create-if-absent check finds it and skips seeding, the canonical guidelines are never loaded. The fix is minimal (one more route check on POST). However, the spec explicitly chose "protect existing blocks" as the guard scope — extending to CREATE is a new scope decision. In pre-production this scenario is unlikely (who would manually create a block with this internal name?), but the seeder's non-overwriting design makes it a hard failure if it does happen.

### Decision

```
Decision: apply
Modification (if apply-with-modification): n/a
Reject reason (if reject): n/a
```

---

## How to resume

After editing the `Decision:` line above, re-invoke:
`spec-reviewer: review docs/config-agent-guidelines-spec.md`
