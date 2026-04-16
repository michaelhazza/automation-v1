# Brief — Configuration Agent Runtime Guidelines

**Status:** Ready to start in a new branch.
**Parent context:** Discussed in branch `claude/task-memory-context-retrieval-Mr5Mn` while scoping the broader memory & briefings spec. This work is independent and should ship first.

---

## 1. Purpose

Give the Configuration Agent a durable, runtime-loaded set of reasoning guidelines so it diagnoses problems and proposes solutions consistently — without code changes when the guidelines evolve.

The agent is a **configurator first, builder last**. The guidelines codify that priority order, the diagnostic framework, and the tier model.

---

## 2. Decisions already made

The following are settled — do not re-litigate in the new branch.

### Storage location

**Platform-level memory block, auto-attached to the Configuration Agent, seeded from a canonical repo file.**

- Memory blocks are existing infrastructure (`server/services/memoryBlockService.ts`, `server/routes/memoryBlocks.ts`, schema in `server/db/schema/memoryBlocks.ts`).
- Block sits in the **org subaccount** (where the Configuration Agent runs).
- Canonical version lives in repo at `docs/agents/config-agent-guidelines.md`.
- On deploy, the canonical file seeds (or upserts) the memory block.
- Block is marked system-managed so it is not accidentally deleted.

### Runtime loading

**Existing pipeline — zero new plumbing.** Memory blocks attached to an agent are injected into context at run start by `memoryBlockService.getBlocksForAgent()` in `agentExecutionService.ts:678-760`.

Optional enhancement (defer if not needed): also expose the canonical doc as a readable data source so the agent can re-fetch the full text mid-run via `read_data_source`.

### UI for non-technical edits

**No new UI required.** Memory block CRUD already exists as a tab on `client/src/pages/SubaccountKnowledgePage.tsx`. When viewing the org subaccount, the guidelines block appears in the Memory Blocks tab. Org admins can edit it.

Governance affordances (version history, diff vs canonical, reset-to-canonical, sandbox testing) are **out of scope here** — they land as part of the memory & briefings spec on the parent branch.

---

## 3. The guidelines text — draft + 10 amendments to resolve

The base draft (Three C's, Priority Order, Tier Model, Context Placement table, Diagnostic Checklist) was authored by the user and is solid as a foundation. **Resolve these gaps with the user before publishing the canonical file:**

1. **Restate-and-confirm step before diagnosis.** Agent restates the request in its own words and asks one clarifying question if multiple interpretations are plausible.
2. **Confidence-tiered action policy.** Explicit tiers: >0.85 auto-apply, 0.6–0.85 propose-and-await-approval, <0.6 ask. Reference the same tiers used elsewhere in the platform.
3. **Tier-edit permissions.** System admins → platform; agency admins → agency; agency staff → subaccount. Agent refuses cross-tier edits without explicit permission.
4. **Safety gates that override the Three C's.** Anything touching client-facing communication, billing, legal, or pricing requires human approval regardless of confidence.
5. **Memory block change blast radius.** Editing a block affects every future run that uses it. Agent must call this out and offer a "scoped override" alternative when changes only need to apply narrowly.
6. **Diagnosis audit trail.** Agent writes a short rationale ("I chose context fix because X — existing skill Y already covers this if it has access to Z") into the run log.
7. **Stale / contradicting context handling.** Supersede with audit trail rather than delete. Reference the supersession pattern.
8. **"Creating a new skill" mechanics.** Either define how the agent actually creates skills in this codebase, or restrict it to "describe what's needed and surface to engineering." Avoid the agent proposing skills it cannot create.
9. **Escalation rule.** If the diagnostic checklist completes and no confident path exists, escalate. Specify *who* it escalates to (subaccount manager / agency owner / platform admin).
10. **Glossary.** Define the difference between "configuration" and "instruction" so the agent does not conflate them.

The user should sign off on each amendment (or modify) before the canonical file is written.

---

## 4. Implementation work breakdown

Estimated as Standard-class work — no architect agent required, but pr-reviewer + dual-reviewer before PR.

### Step 1 — Resolve the 10 amendments
Short conversation with the user. Lock the canonical text.

### Step 2 — Author the canonical file
Path: `docs/agents/config-agent-guidelines.md`
Contains the full guidelines text (base draft + 10 amendments).

### Step 3 — Seed mechanism
Add a one-shot seeder that, on deploy, upserts the memory block from the canonical file.
- Block name: `config-agent-guidelines` (or similar)
- Owner scope: org subaccount
- Auto-attach: Configuration Agent
- Marked system-managed (cannot be deleted via UI)
- Idempotent — re-running does not duplicate

Likely lives in `server/services/` or `server/jobs/` alongside other seed/migration jobs. Pattern-match existing seeders.

### Step 4 — Configuration Agent attach + verification
Confirm the block attaches at run start and the guidelines are visible in the agent's effective system context. Add a smoke test.

### Step 5 — Permissions check
Confirm only org admins can edit this block in the existing Knowledge page UI. If the existing UI does not respect the system-managed flag for read/write gating, add a small permission guard. Otherwise nothing to build.

### Step 6 — Behavioural check
Run a few test scenarios against the Configuration Agent with the new block attached:
- Ambiguous request → does it restate and confirm?
- Request that an existing skill could solve → does it choose configure-existing instead of create-new?
- Request involving client-facing email → does it route to human approval?
- Cross-tier edit attempt → does it refuse?

If behaviour is wrong, the fix is in the guidelines text, not code.

---

## 5. Out of scope (defer to memory & briefings spec on parent branch)

- Version history UI for memory blocks
- Diff viewer (current runtime vs canonical)
- "Reset to canonical" button
- Draft → review → publish workflow
- Sandbox / "test against this scenario" feature
- Any change to the Configuration Agent's toolset
- Subaccount-onboarding mode for the Configuration Agent
- The broader memory automation work (pruning, decay, conflict resolution, auto-synthesised blocks, etc.)
- Reusable `DeliveryChannels` component
- Weekly briefing / weekly digest playbooks

These all live in the next spec on the parent branch.

---

## 6. Open questions for the user (to resolve in Step 1 conversation)

1. The 10 amendments above — accept all, modify which ones?
2. Block name — `config-agent-guidelines` or something else?
3. Should the seeder run on every deploy (idempotent upsert) or only on first deploy (manual re-seed afterwards)?
4. If a runtime edit diverges from canonical, does the next deploy overwrite the runtime version or preserve it? Recommendation: preserve runtime + log a warning, with explicit "Reset to canonical" being the only path back. (Reset-to-canonical UI ships in the parent branch's spec; until then, the reset is a manual ops step.)
5. Should this block be readable by other system agents (e.g., a future Triage Agent that reasons about config requests)? Default: yes, read-only.

---

## 7. Suggested workflow

This is Standard-class work — short spec is enough; full architect plan not required.

1. **Resolve the 10 amendments + open questions** with the user.
2. **Write a short spec** at `docs/specs/config-agent-guidelines-spec.md` covering the canonical text, seed mechanism, attach behaviour, permissions, and verification scenarios.
3. **Run spec-reviewer** (one or two iterations is likely sufficient — this is a small spec).
4. **Implement** in the new branch.
5. **pr-reviewer → dual-reviewer** before PR.
6. **Merge.** Then return to parent branch for the memory & briefings spec.

---

## 8. Branch naming

Recommend: `claude/config-agent-guidelines` or similar. New branch from `main` (not from the parent memory branch — these are independent and should not depend on each other).

---

## Appendix — Why this work first

- Independent infrastructure (memory blocks already shipped).
- Smaller surface, faster ship.
- The memory & briefings spec on the parent branch extends the Configuration Agent. Doing the guidelines first means we extend an agent that already has clear governance, instead of re-litigating its behaviour mid-spec.
- De-risks the bigger spec by establishing one of its foundational assumptions as fact.
