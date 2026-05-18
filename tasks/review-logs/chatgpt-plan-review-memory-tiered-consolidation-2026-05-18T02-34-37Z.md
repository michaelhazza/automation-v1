# chatgpt-plan-review — memory-tiered-consolidation

**Date:** 2026-05-18
**Plan:** tasks/builds/memory-tiered-consolidation/plan.md
**Mode:** manual

**Locked decisions (do not reopen):**
- OQ-1: `consolidation_tier` lives on `workspace_memory_entries` (spec text saying `memory_blocks` is documentation error).
- OQ-2: skip `memory_block_versions` mint on promotion; `memory.block.promoted` event is the audit trail.
- Profile names match the actual `RetrievalProfile` union (`temporal | factual | general | exploratory | relational`); spec's illustrative names are NOT a contract.

---

