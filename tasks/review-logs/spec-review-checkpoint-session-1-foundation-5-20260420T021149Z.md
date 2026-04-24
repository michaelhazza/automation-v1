# Spec Review HITL Checkpoint — Iteration 5 (FINAL — LIFETIME CAP REACHED)

**Spec:** `tasks/builds/clientpulse/session-1-foundation-spec.md`
**Spec commit:** working-tree (iter-4 decision applied + iter-5 mechanical findings applied)
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 5 of 5 (HARD LIFETIME CAP — no iteration 6 permitted without explicit user authorisation per CLAUDE.md)
**Timestamp:** 2026-04-20T02:11:49Z

---

## CRITICAL — LIFETIME CAP STATUS

**This is the final spec-reviewer iteration under the 5-lifetime cap.** The review loop has now exited. The three findings below are directional — they cannot be resolved by re-invoking the `spec-reviewer` agent. The human must decide, **outside the loop**, whether to:

- **(a) Resolve in-code during implementation.** Treat these as "known directional notes" the architect / builder handles in the relevant chunk. Ship the spec as-is; apply the resolution at chunk A.1 / A.3 / 7 / 5 as appropriate. Cheapest option; recommended unless the findings materially shift scope.
- **(b) Bust the 5-iteration cap.** Requires explicit user authorisation per CLAUDE.md. Only needed if the human thinks Codex would find substantively more on a 6th pass, which is unlikely at this stage.
- **(c) Accept the spec as-is with these caveats logged.** Mark the findings as "acknowledged, not resolved" and proceed to architect pass. Implementer uses judgement per-chunk.

All 6 of iter-5's mechanical findings have been applied already. The 3 directional findings below are the final residuals.

---

## Iter-5 mechanical findings already applied

Codex surfaced 10 findings; 6 were classified mechanical, 1 was partial, and 3 are directional (this checkpoint).

- **Finding 3** — §4.8 "render effective config for that timestamp" language tightened; history readers must treat `snapshot_after=NULL` as a pure creation marker, not a point-in-time reconstruction anchor. Current adopted-template defaults are mutable so the NULL row cannot contractually support reconstruction.
- **Finding 4** — §7.3 clarified that each successful or queued Screen-3 POST produces the normal non-NULL `config_history` row via the standard write path; the §7.2 step-6 creation marker with `snapshot_after=NULL` remains the only entry iff the operator skips Screen 3 without changes.
- **Finding 5** — §3.6 stale empty-frozen-array alias replaced with `getSensitiveConfigPaths()` function alias backed by the registry. All in-repo imports migrated in the same chunk (§3.7, §9.3 updated).
- **Finding 6** — S1-5.2 gate text "which operational defaults to seed on apply" replaced with "`operational_config_seed` block is rendered read-only as informational preview only" per the §6.5 lock.
- **Finding 7 (partial)** — new §9.6 "Files to rename or delete (explicit)" subsection added; known-retired paths listed with landing chunks. Audit-deferred items (webhook handlers, subaccount-create retarget) intentionally NOT pulled in per the §10.8 locked decision.
- **Finding 8** — §7.4 explicit auth contract added: both onboarding endpoints use the authenticated middleware chain; `POST /api/onboarding/complete` requires the same org-admin eligibility as the wizard entry path.
- **Finding 10** — S1-A4 ship-gate text "either redirects or is retired entirely" replaced with the locked decision "is retired entirely (no redirect)" per §4.2 / §10.3.

---

## Summary of remaining directional findings

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 5.1 | §7.3 Screen 3 "Scan frequency" + "Alert cadence" not threaded | Ship as-is, drop them, or add schema fields + editors? | **Option C — drop both controls.** Keeps session scope intact; churn-bands summary remains. | Adding to §6.2 is scope creep; keeping as-is leaves unfinished plumbing. |
| 5.2 | §4.5 / §2.6 read-contract shape — is `overrides` full or sparse, is deep-merge runtime-validated? | Internal inconsistencies in type shape + cast-without-validation. | **Option B — split the fix.** Apply type-signature change as mechanical in implementation; defer runtime `.parse()` swap. | Type-shape is mechanical; `.parse()` switches runtime validation posture on hot read path. |
| 5.3 | §5.5 vs §6 per-block deep-link UX drift | Ship the per-block UX or delete the §5.5 claim? | **Option B — delete §5.5 bullet.** Ship page-level button only for Session 1. | Scope discipline — per-block UX is unfunded in §6.2; better as deliberate Session 2 add. |

---

(Full finding bodies in the sections below.)

---

## Finding 5.1 — §7.3 Scan frequency + Alert cadence controls not threaded through §6.2 / §4 / §9

**Classification:** directional
**Signal matched:** "Scope signals — Remove this item from the roadmap" OR "Add this item to the roadmap" — choice is between shipping two new persisted settings with editors or removing two UX controls from the wizard. Both are scope changes.
**Source:** Codex Finding 1
**Spec section:** §7.3 Screen 3 bullets 1–2, §6.2 editor inventory, §4.1 / §4.5 / §9.1–§9.4 file inventory

### Finding (verbatim)

> `§7.3 Screen 3`, `§6.2`, `§9.1–§9.4`
> Problem: `Scan frequency (hours)` and `Alert cadence` are introduced as onboarding edits, but the spec never names their persisted `operational_config` paths, never adds them to the schema/editor inventory, and never adds any file work for them.
> Fix: Delete those two controls from `§7.3` unless you also name their exact persisted fields and thread them through `§6.2`, `§4.1/§4.5`, and `§9`.

Verified by spec-reviewer:

- §6.2's editor inventory covers 10 blocks; none has an obviously-named "scan frequency" or "alert cadence" field.
- `interventionDefaults` has `cooldownHours` (adjacent but not equivalent); `alertLimits` has per-run / per-account numeric caps (adjacent but not equivalent to daily/weekly/monthly/off cadence).
- §4.1 / §4.5 config shape doesn't name these; §9 has no file work for schema additions.

Three options:

- **Option A — Add to §6.2 inventory + §4 schema + §9 file work.** Define new fields, add editors, add file entries. Biggest scope add.
- **Option B — Add to §6.2 as existing-schema controls.** Requires chunk-5 audit of actual schema to confirm adjacent fields exist under different names.
- **Option C — Drop both controls.** Keep churn-band cutoffs summary + deep-link only.

### Recommendation

**Option C — drop both controls.** Concrete edits:

- **§7.3 Screen 3 bullets:** remove "Scan frequency (hours)" and "Alert cadence" bullets; keep "Churn-band cutoffs" bullet + "Adjust thresholds" deep-link. Replace intro: "One impactful override, surfacing the churn-band cutoffs for immediate operator adjustment; other tuning happens in ClientPulse Settings post-onboarding."
- **§10.6 Onboarding wizard:** add row: "Scan frequency + alert cadence on Screen 3 | Dropped from Session 1 wizard scope; operator tunes post-onboarding via ClientPulse Settings | §7.3".

### Why

Option C is recommended because §7.3 is a soft-touch onboarding surface — shipping it with two controls that have no plumbing behind them is worse than shipping it with one working control. Adding two new schema fields + editors is material scope addition with ripple effects; unlikely to be the right call in the final session. Option C is the smallest reversible choice.

### Classification reasoning

Matches "Scope signals — Remove this item from the roadmap" (Option C) AND "Add this item to the roadmap" (Option A). Any resolution is a scope call.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 5.2 — §4.5 / §2.6 read-contract type + validation shape

**Classification:** directional
**Signal matched:** "Change the interface of X" — switching from `as OperationalConfig` to `schema.parse(...)` changes throw semantics on every read; switching typed response shape changes client-side assumptions.
**Source:** Codex Finding 2
**Spec section:** §4.5 response shape, §2.6 `getOperationalConfig` read function

### Finding (verbatim)

> `§4.5` and `§2.6`
> Problem: The read contract is internally inconsistent: `overrides: OperationalConfig | null` implies a fully normalised object, but `hasExplicitOverride(path)` depends on sparse key presence, and `§2.6` only type-casts `deepMerge(...) as OperationalConfig`, which does not enforce the "full valid config with schema defaults" claim from `§4.5`.
> Fix: In `§4.5`, change `overrides` to `DeepPartial<OperationalConfig> | null` (or equivalent raw sparse JSON type) with the note "do not schema-fill defaults"; in `§2.6`, replace the final cast with `return operationalConfigSchema.parse(deepMerge(systemDefaults, overrides));`.

Verified by spec-reviewer:

- §4.5 response types `overrides` as `OperationalConfig | null` but semantics are sparse: `hasExplicitOverride(path)` depends on "path is present in overrides."
- §2.6's final line is `return deepMerge(systemDefaults, overrides) as OperationalConfig;` — cast with no runtime validation.
- Type-shape fix is a mechanical-shape change; runtime `.parse()` swap changes read-path throw semantics on hot path.

### Recommendation

**Option B — split the fix.**

- **At implementation (treat as mechanical in chunk A.1):** change §4.5's `overrides` field type from `OperationalConfig | null` to `DeepPartial<OperationalConfig> | null` (or dedicated `OperationalConfigOverride` type alias). Add sentence: "The override field is the raw sparse JSON row — it is NOT schema-filled with defaults; missing keys signal 'no explicit override at this path'."
- **Explicit defer (directional):** do NOT add `operationalConfigSchema.parse(deepMerge(...))` to §2.6 in Session 1. Read path is called on every effective-read; introducing throw-on-invalid is a posture change the human should decide deliberately.

**Alternatives:**

- **Option A — apply Codex's full fix verbatim.** Swap both. Risk: legacy override rows that are partially schema-invalid start throwing. Needs repair migration + validity gate.
- **Option C — reject both parts.** Leave as-is. Minor type-naming issue; existing cast pattern.

### Why

Option B splits the signal honestly: type-name-shape is real and cheap; runtime-validation is a real posture change that needs deliberate choice. Applying the type change alone removes the "internal inconsistency" concern; deferring `.parse()` avoids a new throwable on the hottest read path.

### Classification reasoning

Type-signature change is mechanical-adjacent; runtime-validation posture change is a "Change the interface of X" directional signal. Split response is the honest call.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 5.3 — §5.5 per-block "Ask the assistant" deep-links vs §6 page-level button

**Classification:** directional (UX scope)
**Signal matched:** "Scope signals — Add this item to the roadmap" OR "Remove this item from the roadmap" — choosing between per-block contextual prompts and only a page-level button is a UX scope call.
**Source:** Codex Finding 9
**Spec section:** §5.5 deep-link usage list, §6.1 Settings page header, §6.2 section cards, §9.2 / §9.4 file inventory

### Finding (verbatim)

> `§5.5`, `§6.1–§6.2`, `§9.2`, `§9.4`
> Problem: The popup spec says the Settings page has per-block "Ask the assistant to change this" deep-links, but the Settings-page contract and file inventory only mention a page-level "Open Configuration Assistant" button.
> Fix: Either add the per-card deep-link to `§6.2` and the relevant client file rows, or delete the Settings-page bullet from `§5.5` so the surfaces stay aligned.

Verified by spec-reviewer:

- §5.5 literally says: "Used by: ClientPulse Settings page: 'Ask the assistant to change this' links next to each editor block."
- §6.1 has only a page-level "Open Configuration Assistant" button.
- §6.2 editor-card rows do not mention per-block deep-link triggers.
- §9.2 / §9.4 do not list per-block deep-link component work.

### Recommendation

**Option B — delete the §5.5 Settings-page bullet.** Ship only the page-level button per §6.1 for Session 1. Per-block deep-link UX lands in Session 2 Phase 6 (Drilldown) or Phase 8 (widget polish).

Concrete edits:

- **§5.5 "Used by" list:** replace ClientPulse Settings bullet with "ClientPulse Settings page: page-level 'Open Configuration Assistant' button (per §6.1) — per-block contextual deep-links deferred to Session 2."
- **§10.7 Out of scope:** add bullet: "Per-block 'Ask the assistant' deep-links on ClientPulse Settings cards (deferred to Session 2 — Phase 6 drilldown + Phase 8 widget polish)".

**Alternative:**

- **Option A — Add to §6.2 + §9.** Add per-card contextual-prompt trigger to each editor row; add shared prompt-builder helper to §9.2; thread through each block-editor row. Adds ~0.5 day of UX work + copy drafting.

### Why

Session 1 is a foundation sprint; per-block deep-links are a small-but-real scope add unfunded in §6.2. Page-level button meets the minimum bar. Per-block prompts are higher-leverage when combined with Drilldown's high-risk-account context (Session 2 Phase 6) and the dashboard widget's contextual signals (Session 2 Phase 8) — folding them into that session's design pass is cleaner than half-shipping here.

### Classification reasoning

Codex fix is phrased as "either add X or delete Y" — the choice is a scope decision, not mechanical alignment. Either direction is defensible; picking one is the human's call.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resolve (and why the loop does NOT resume)

The 5-iteration lifetime cap has been reached. **Re-invoking `spec-reviewer` after editing these decisions will NOT trigger a 6th iteration** — the agent will exit with "lifetime cap reached" and point at this file.

The human resolves these findings by **either**:

1. **Editing each `Decision:` line** to `apply`, `apply-with-modification`, `reject`, or `stop-loop` as a record-keeping decision (the spec edits are then applied manually OR carried as directional notes into the build chunks). The file remains as the audit trail.
2. **Handing the checkpoint to the architect pass.** When invoking `architect` for Session 1, pass this file as context. The architect produces the implementation plan with these findings either resolved (via spec edits) or acknowledged (as known directional notes).
3. **Busting the cap** (requires explicit "I authorise a 6th iteration" language per CLAUDE.md). Unlikely to be useful given iter-3 → iter-4 → iter-5 trajectory (1 → 1 → 3 directional, mostly scope-shape questions, not consistency bugs).

---

## Iteration 5 Summary

- Mechanical findings accepted:  6 (Findings 3, 4, 5, 6, 8, 10)
- Mechanical findings partially accepted:  1 (Finding 7 — §9.6 added; audit placeholders NOT pulled in per §10.8 lock)
- Mechanical findings rejected:  0
- Directional findings:          3 (Findings 1, 2, 9 → checkpointed as 5.1, 5.2, 5.3)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          this file
- HITL status:                   pending — but the LOOP IS EXITED regardless of resolution

**Exit condition:** iteration-cap reached (5 of 5). Loop will not resume without explicit cap-bust authorisation.

**Spec build-readiness assessment:** mechanically tight after iter-5's 6 applications. The 3 directional residuals are scope-shape calls, not consistency bugs. Any of the three can be resolved in-code during the build phase (chunks A.1 / A.3 / 6 / 7) without creating rework. The spec is build-ready under option (a) "resolve in-code during implementation."
