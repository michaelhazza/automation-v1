# Spec Review Log — session-1-foundation iteration 3

## Findings classified and dispositioned

```
FINDING #1 (Codex)
  Source: Codex
  Section: §7.2 step 2, knock-ons in §7.1 + §8.4
  Description: createFromTemplate eagerly copies operational_defaults into organisations.operational_config_override, marking every field as hasExplicitOverride=true on day one — contradicts §4.5 iter-1 semantic.
  Classification: directional
  Reasoning: The "what does override contain at org-create" question is a product-semantic choice — inherit-live-platform-changes (NULL) vs freeze-on-create (eager) vs hybrid (re-adopt button) vs schema-level workaround (per-leaf timestamps). Signal matched: "Change the interface of X". The human owns the choice.
  Disposition: HITL-checkpoint
  Checkpoint: tasks/spec-review-checkpoint-session-1-foundation-3-20260420T024500Z.md (Finding 3.1)

FINDING #2 (Codex)
  Source: Codex
  Section: §4.5, §6.4, §10.5
  Description: §4.5 says "overridden iff present in overrides"; §10.5 #3 says reset writes the system default. After reset, hasExplicitOverride=true, so §6.4's "button disabled, already at default" state is unreachable.
  Classification: mechanical
  Reasoning: Real UX contradiction inside iter-1-locked content. The fix (two derived states: hasExplicitOverride + differsFromTemplate) doesn't change what gets written — it fixes which states surface to the UI. Not a re-litigation of iter-1's reset decision, just correcting a logic bug in the already-locked semantic.
  Disposition: auto-apply (applied)
  Fix: §4.5 rewritten to introduce hasExplicitOverride(path) (presence-in-overrides) + differsFromTemplate(path) (effective vs system default). §6.4 reset button enablement now driven by differsFromTemplate. Badge display clarified. No backend change.

FINDING #3 (Codex)
  Source: Codex
  Section: §2.4 rollback, §8.8
  Description: Rollback restores from operational_config_seed, which only covers pre-migration data. Post-migration writes to operational_config_override are lost on _down.
  Classification: mechanical (apply-with-context-modification)
  Reasoning: False claim in §8.8 ("No data loss risk") under the literal rollback procedure. But in pre-production (live_users: no, commit_and_revert) dev data is disposable — adding bidirectional rollback machinery is over-engineering against the framing. Mechanical fix: clarify the claim is framing-scoped.
  Disposition: auto-apply (applied, modified)
  Fix: §8.8 rewrote the "No data loss risk" statement to explicitly scope it to the pre-production framing, explain that post-migration writes to the override column would be dropped by a straight _down (acceptable under live_users=no), and commit to adding a bidirectional rollback step IF Session 1 ships past the first live-user milestone.

FINDING #4 (Codex)
  Source: Codex
  Section: §2.2, §6.5, §7.2 step 3, S1-5.2
  Description: Three sections describe three different contracts for where new subaccount config comes from (seed field, org config, "reference only"). Inconsistent.
  Classification: mechanical
  Reasoning: Consistency fix aligning prose with §2.2's locked rationale ("stop reading seed after initial adopt; all runtime reads through org column"). No direction change — scrub stale language elsewhere.
  Disposition: auto-apply (applied)
  Fix: §2.2 rewritten to explicitly say operational_config_seed is informational only and NOT read at subaccount creation. §6.5 read-only preview message rewritten to avoid "will seed" language. §7.2 step 3 expanded to say the seed field is an informational snapshot, not read by any runtime path. S1-5.2 already aligned by iter-2 edit.

FINDING #5 (Codex)
  Source: Codex
  Section: §3.8, §3.7, §9.1
  Description: §3.8's operationalConfigRegistry.ts is "same file OR sibling" — ambiguous file ownership; not listed in §9.1.
  Classification: mechanical
  Reasoning: Unnamed new primitive + file inventory drift — classic rubric catch. Folding the roots registry into the existing sensitiveConfigPathsRegistry.ts file is the simpler choice (one composability surface per module, no additional file inventory to wire up).
  Disposition: auto-apply (applied)
  Fix: §3.8 rewritten to fold registerOperationalConfigRoots + isValidConfigPath into server/config/sensitiveConfigPathsRegistry.ts (not a new file). §3.7 row description extended to list both APIs exported by the single file.

FINDING #6 (Codex)
  Source: Codex
  Section: §3.5, §9.3
  Description: interventionActionMetadata.ts listed twice in §3.5 with conflicting guidance; clientPulseInterventionProposerPure.ts in §9.3's "Files to modify" with "No change".
  Classification: mechanical
  Reasoning: Pure file inventory cleanup — classic rubric catch.
  Disposition: auto-apply (applied)
  Fix: §3.5 collapsed to one authoritative entry for interventionActionMetadata.ts (with the actual rename). Removed "No change" duplicate entry. §9.3 removed clientPulseInterventionProposerPure.ts row (no change = not in modify table).
```

## Iteration 3 Summary

- Mechanical findings accepted:  5 (Codex #2 derived states, #3 §8.8 data-loss, #4 subaccount-seeding, #5 config registry fold, #6 touch-list cleanup)
- Mechanical findings rejected:  0
- Directional findings:          1 (Codex #1)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-session-1-foundation-3-20260420T024500Z.md
- HITL status:                   pending
- Spec state at end of iteration: mechanically tightened against 5 Codex findings; 1 directional item staged for human decision (org-create override-row contents).
