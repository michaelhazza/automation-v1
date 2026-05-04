# ChatGPT Spec Review Session — framework-standalone-repo — 2026-05-04T00-52-24Z

## Session Info
- Spec: tasks/builds/framework-standalone-repo/spec.md
- Branch: claude/evaluate-summonaikit-B89k3
- PR: #256 — https://github.com/michaelhazza/automation-v1/pull/256
- Mode: manual
- Started: 2026-05-04T00:52:24Z

---

## Round 1 — 2026-05-04T00:52:24Z

### ChatGPT Feedback (raw)

> Overall: sound direction, but the sync design is under-specified in a few important places. Submodule + generated copy is reasonable, but the spec currently over-promises "one-line upgrade" while relying on state, hashes, prior versions, glob expansion, partial JSON merge, and manual merge files that need tighter contracts.

**Key feedback**

**1. Architecture: submodule + sync is valid, but not "simple"**
- Submodule + sync over zip/subtree/symlink/npm package is the right call.
- But the spec should acknowledge real complexity: submodules are operationally annoying for many developers; generated files create two copies (source in `.claude-framework/`, applied copy in `.claude/`, `docs/`, `references/`); sync correctness depends entirely on `.framework-state.json`.
- Frame this as a controlled generated-file system, not just "one-line upgrade".
- Recommended invariant: target repos must treat framework-managed files as generated artifacts. Local edits to framework-managed files are allowed but become explicit customisations and are no longer silently upgradeable.

**2. Biggest flaw: sync algorithm compares against the wrong expected content**
- §4.5 step 5a says "Compute the EXPECTED current target version: read framework's source, apply substitutions" — but after `git submodule update --remote`, `.claude-framework/` already points at the NEW framework version. That means "expected current" is actually the new expected content, not the previously applied content.
- §6 fixes this somewhat by saying compare to `lastAppliedHash`, but §4.5 and §6 conflict.
- Correct algorithm: Read target file → Compare target hash to `state.files[path].lastAppliedHash` → If equal, file is clean, apply new substituted framework content → If not equal, file was locally modified, flag customisation → Write new content only for clean files → Update `lastAppliedHash` only for files successfully written.
- Do not try to reconstruct the old expected file from current framework source. The state hash is the source of truth.

**3. Three-way merge flow may not actually work**
- Spec says merge file contains operator current + framework old + framework new — but the old framework version is not necessarily available after submodule update unless you fetch/check out the old tag or commit.
- State currently records `adoptedFromCommit`, but per-file state does not record the source framework commit/version that produced each file.
- Fix: per file store `lastAppliedHash`, `lastAppliedFrameworkVersion`, `lastAppliedFrameworkCommit`, `lastAppliedSourcePath`.
- For v1: write `<file>.framework-new`, leave the target untouched, print "manual merge required". Skip the full three-way `.merge` file unless prepared to implement old-base retrieval. Current merge proposal is over-engineered for v1.

**4. `customisedLocally: true` is currently ambiguous**
- State has both `customisedLocally: true` and `syncIgnore: []`; spec says setting `customisedLocally` lets the operator opt out, AND adding to `syncIgnore` skips the file. These should be separate concepts.
- Recommendation: make `syncIgnore` the only opt-out mechanism. Treat `customisedLocally` as derived metadata, not an operator control.

**5. File ownership boundary is mostly right, but too broad in some docs**
- Boundary good for never touching CLAUDE.md, KNOWLEDGE.md, architecture.md, tasks/.
- Challenge as framework-managed: `docs/spec-context.md`, `docs/doc-sync.md`, `references/verification-commands.md`, `docs/frontend-design-examples.md` — likely to become project-specific quickly.
- Better model: agent prompts/hooks/generic checklists = framework-managed; project-facing docs/templates = scaffold-on-adopt only; project-specific operational docs = project-owned after adoption.
- Add manifest modes: `"mode": "sync" | "adopt-only" | "settings-merge"`. Cleaner than `substituteAt`.

**6. `.claude/settings.json` partial ownership needs a stricter contract**
- "Sync only owns the hooks block" is good, but fragile.
- Define: existing-hooks behaviour (append/replace/namespace), project hooks coexisting under same hook event, hook order.
- Recommendation: framework owns only a namespaced block (`hooks.framework` + `hooks.project`). If Claude Code requires flat hook shape, sync needs deterministic merge rules and tests for collision handling.

**7. Migration risk: self-adoption may overwrite internal Automation OS customisations**
- Spec is optimistic that Automation OS files match `setup/portable/` after substitution. Current internal files may have diverged beyond placeholder substitution.
- Add a preflight phase: before self-adoption, run a dry-run diff comparing current internal files against substituted portable files. Classify as expected customisation, framework drift to backport, or accidental divergence. Before adding the submodule and deleting `setup/portable/`.

**8. Manifest globbing is under-specified**
- Where sync systems rot: file deletion, renames, orphaned files.
- Define: deterministic glob expansion order; behaviour when a file is removed from manifest; whether sync deletes generated files no longer present upstream; rename = delete+add or migration mapping; whether unmanaged sibling files are ignored.
- Add manifest `removedFiles` entries with `action: warn-only`. Default warn, do not delete for v1.

**9. Missing risks for §9** — state file corruption/loss; framework file rename/delete; settings merge collision; self-adoption drift; submodule dirty state; tag/branch confusion (`.gitmodules branch = v2.1.0` is not how tags should be treated); security/trust of `sync.js` (target repos execute code from submodule); placeholder collision (find-replace may hit examples).

**10. Open questions feedback**
- 11.1 — Reframe as "Where is framework dev authored, and how do changes flow back without editing generated target files?" Recommendation: Option B (Automation OS as consumer) with convenience checkout allowed.
- 11.2 — Default private initially.
- 11.3 — Defer CLI wrapper. Add `--dry-run`, `--check`, `--doctor` flags before npm wrappers.
- 11.4 — No auto-commit. Add explicit invariant: `sync.js` never stages, commits, pushes, or deletes without explicit flags.
- 11.5 — Don't rely on `doNotTouch` saying 0006+. State: "Any file in `docs/decisions/` not matched by a managed manifest entry is project-owned."
- 11.6 — Agree with Option A. Preserve v2.1.0 as the final pre-standalone reference. Build standalone sync as v2.2.0.

**Missing open questions to add**
- Should files be sync-managed or adopt-only by default? (Especially for docs that naturally become project-specific.)
- Should sync support dry-run/check mode before writing? (Make it mandatory.)
- What is the deletion/rename policy for framework-managed files? (Warn-only for v1.)
- What is the hook merge contract for `.claude/settings.json`?
- What is the security model for executing `sync.js` from the framework repo?
- How do we handle projects that intentionally fork an agent? (`syncIgnore` is probably right, but make it first-class.)

**Recommended changes before implementation**
1. Rewrite sync algorithm around `lastAppliedHash`, not reconstructed expected content.
2. Add `mode: sync | adopt-only | settings-merge` to manifest.
3. Make dry-run mandatory: `node .claude-framework/sync.js --dry-run`.
4. Add per-file `lastAppliedFrameworkCommit`.
5. Simplify v1 manual merge to "write `.framework-new`, warn, skip".
6. Add self-adoption preflight diff before deleting `setup/portable/`.
7. Tighten `.claude/settings.json` hook merge semantics.
8. Add deletion/rename policy.

**Verdict:** good architecture, but tighten the sync contract before building. Main risk: a sync engine that seems simple but becomes ambiguous around customised files, adopt-only docs, settings merges, and framework file renames.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1: Frame as controlled generated-file system | technical | apply | auto (apply) | medium | Honest framing prevents under-specification. |
| F2: Invariant — framework-managed files are generated artifacts; local edits become explicit customisations | user-facing | apply | user: apply | medium | Operator-visible expectation about framework relationship. |
| F3: Fix sync algorithm — compare to lastAppliedHash, not reconstructed expected | technical-escalated (high severity) | apply | user: apply | high | §4.5/§6 internally contradict; central algorithmic bug. |
| F4: Add lastAppliedFrameworkVersion + Commit + SourcePath per file | technical | apply | auto (apply) | medium | Future-proofs old-base retrieval; fields cheap now. |
| F5: Simplify v1 merge — write `.framework-new`, leave target untouched, no three-way `.merge` | user-facing | apply | user: apply | high | Changes described upgrade-conflict workflow. |
| F6: syncIgnore = sole opt-out; customisedLocally = derived | technical | apply | auto (apply) | medium | Resolves state-model ambiguity. |
| F7: Manifest `mode: sync \| adopt-only \| settings-merge`; reclassify spec-context, doc-sync, verification-commands, frontend-design-examples as adopt-only | user-facing | apply | (pending user) | high | Reclassification changes which files get future syncs. |
| F8: Tighten settings.json hook merge contract — namespace block vs flat-merge rules | technical-escalated (high, needs operator input) | apply | user: flat-merge (framework owns .claude/hooks/* entries; project wins on collision; framework-first order) | high | Operator confirmed flat-merge. Claude Code requires flat hooks shape. |
| F9: Self-adoption preflight diff before deleting setup/portable/ | technical-escalated (high severity) | apply | user: apply | high | Migration safety. |
| F10: Manifest globbing — expansion order, removedFiles entries, deletion/rename warn-only v1 | technical | apply | auto (apply) | medium | Algorithm-correctness gap. |
| F11: Add 8 missing risks to §9 | technical | apply | auto (apply) | medium | Risk completeness. |
| F12: OQ 11.1 — A vs B (framework dev location) | user-facing | (operator decides) | user: B — Automation OS as consumer; framework dev in separate checkout | medium | "Never edit generated files." Avoids accidental edits without upstreaming path. |
| F13: OQ 11.2 — public vs private | user-facing | (operator decides) | user: private initially — public later after stabilising across 2-3 repos | medium | Preserve optionality; framework encodes internal operating leverage. |
| F14: OQ 11.3 — defer CLI wrapper; add --check + --doctor flags | user-facing | apply | user: apply (defer wrapper; add --check + --doctor alongside --dry-run) | medium | New operator-visible CLI surface. |
| F15: OQ 11.4 — invariant "sync.js never auto-commits/pushes/deletes" | technical | apply | auto (apply) | medium | Strengthens stated preference. |
| F16: OQ 11.5 — manifest-not-matched ⇒ project-owned in docs/decisions/ | technical | apply | auto (apply) | medium | Clearer rule than doNotTouch. |
| F17: OQ 11.6 — confirm Option A; build sync as v2.2.0 | technical | apply | auto (apply) | low | Closes the open question. |
| F18: New OQ — sync-managed vs adopt-only default (resolved by F7 if approved) | technical | apply | auto (apply) | medium | Captures decision the manifest mode raises. |
| F19: --dry-run flag mandatory in v1 | technical | apply | auto (apply) | medium | CLI surface for v1. |
| F20: Deletion/rename policy: warn-only for v1 (folded into F10) | technical | apply | auto (apply) | medium | v1 scope decision. |
| F22: Security model for sync.js (add risk row + open question) | technical | apply | auto (apply) | medium | Trust model documentation. |

(F21 folded into F8; F23 folded into F6.)
| USER-ADD: Monotonic non-destructive writes invariant | user-facing | apply | user: apply | high | "Sync never deletes or overwrites a file that has diverged without explicit operator action." |

### Top themes
1. **Algorithm correctness** — sync must compare to `lastAppliedHash`, not new framework content.
2. **Generated-file mental model** — must be explicit upfront (invariants block).
3. **Scope reduction** — v1 merge simplified to `.framework-new`-only; three-way deferred.
4. **Adopt-only mode** — prevents perpetual customisation conflicts on project-specific templates.
5. **Migration safety** — preflight diff before self-adoption prevents silent loss of internal refinements.

### Applied (auto-applied technical + user-approved user-facing)

**Auto-applied (technical):**
- [auto] F1: Updated Benefits table "one-line upgrade" → "one-command upgrade" with honest framing of sync as controlled generated-file system
- [auto] F4: Added `lastAppliedFrameworkVersion`, `lastAppliedFrameworkCommit`, `lastAppliedSourcePath` fields to per-file state.json schema (§4.4)
- [auto] F6: Made `syncIgnore` the sole opt-out mechanism; `customisedLocally` now documented as informational-only (§4.4, §7)
- [auto] F10: Added `removedFiles` array to manifest (§4.2), defined deterministic lexicographic glob expansion, added warn-only deletion policy
- [auto] F11 + F22: Added 8 new risk rows to §9 (state corruption, rename/delete, settings collision, self-adoption drift, submodule dirty, tag/branch confusion, sync.js security, placeholder collision)
- [auto] F15: Added "INVARIANT: sync.js never stages, commits, pushes, or deletes" to §4.5 and closing line in §11.4
- [auto] F16: Added "any file in docs/decisions/ not matched by manifest is project-owned" rule to §3 (Target-owned section)
- [auto] F17: Closed OQ 11.6 — confirmed Option A + v2.2.0 decision
- [auto] F18: Resolved default-mode question via F7 approval (adopt-only for project-facing docs)
- [auto] F19: Added `--dry-run`, `--check`, `--doctor` flags to §4.5 (flag table)
- [auto] Integrity check: fixed stale `§4.6` → `§4.7` cross-reference in §4.3 (Versioning section renumbered due to insertion of new §4.6 hook-merge contract)

**User-approved:**
- [user] F2 + USER-ADD: Added Invariants block (§1.5 — after Non-goals): generated-file contract + monotonic non-destructive writes
- [user] F3: Rewrote sync algorithm in §4.5 to compare `sha256(target content)` against `state.files[path].lastAppliedHash`, not reconstructed expected content
- [user] F5: Simplified v1 merge to write `<path>.framework-new` only; dropped three-way `.merge` file (§6, §7)
- [user] F7: Added `mode: sync | adopt-only | settings-merge` to manifest (§4.2); reclassified `docs/spec-context.md`, `docs/frontend-design-examples.md`, `docs/doc-sync.md`, `references/verification-commands.md` as `adopt-only` in §3 and §4.2
- [user] F8: Added §4.6 `.claude/settings.json` hook merge contract — flat-merge rules (framework owns .claude/hooks/* entries; project wins on collision; framework-first ordering; deterministic rules + unit tests)
- [user] F9: Added §8 step 6.5 — preflight diff before self-adoption (three-bucket classification: expected customisation / framework drift to backport / accidental divergence)
- [user] F12: Closed OQ 11.1 — Decision: B (Automation OS as consumer; framework dev in separate checkout; rule: never edit generated files directly)
- [user] F13: Closed OQ 11.2 — Decision: private initially (public after 2-3 repos; preserve optionality)
- [user] F14: Closed OQ 11.3 — defer npm wrapper; ship `--dry-run`, `--check`, `--doctor` in v1

---

## Round 2 — 2026-05-04T01:20:00Z

### ChatGPT Feedback (raw)

> This is in very good shape now. You've removed the real structural risks. What's left are edge-case correctness + operational sharpness issues. Nothing here blocks implementation, but a few are worth tightening now because they're painful to retrofit later.
>
> 1. Substitution under-specified (placeholder format hard rule, scoping to substituteAt !== "never" + clean files only, idempotency guarantee). 2. New file handling missing (no lastAppliedHash for post-adoption files; treat as new → write → add to state). 3. Rename hint (possible rename detected print when removed + added paths are similar). 4. .framework-new lifecycle scan at startup. 5. Hook merge identity = command path (replace on match, append otherwise; stable ordering). 6. --doctor claim downgrade (detect divergence only, not provenance; missing state.json → treat all as customised). 7. Submodule dirty definition (uncommitted → block; detached HEAD → allowed). 8. Version pinning command example. 9. --check split: --check = outdated only; --strict = outdated or customised. 10. Structured logging: SYNC file=<path> status=updated|customised|skipped.
>
> Final verdict: Architecture solid, sync model correct, migration safe. Remaining risk: edge-case correctness, not design.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F23: Substitution — hard format rule + scoping + idempotency | technical-escalated (high) | apply | user: apply | high | Silent corruption risk if unspecified. |
| F24: New file handling — if not in state.files → write + add; syncIgnore respected | technical-escalated (high) | apply | user: apply | high | Undefined behaviour on post-adoption framework additions. |
| F25: Rename hint — print possible-rename when removed + new paths are similar | technical | apply | auto (apply) | medium | Low-effort, high-clarity output improvement. |
| F26: .framework-new lifecycle scan at sync start | technical | apply | auto (apply) | medium | Prevents stale unresolved merge files going unnoticed. |
| F27: Hook identity = command path; replace on match, append otherwise; stable order | technical | apply | auto (apply) | medium | Tightens §4.6; prevents duplicates across syncs. |
| F28: Downgrade --doctor claim; missing state.json → treat all as customised | technical | apply | auto (apply) | medium | Spec accuracy; safer failure-mode default. |
| F29: Define submodule dirty: uncommitted → block; detached HEAD → allowed | technical | apply | auto (apply) | medium | Clarifies sync.js startup check. |
| F30: Version pinning command example | technical | apply | auto (apply) | low | Prevents tag/branch confusion for operators. |
| F31: Split --check: outdated only; add --strict: outdated or customised | user-facing | apply | user: apply | medium | Redefines flag approved Round 1; confirmed. |
| F32: Structured logging: SYNC file=<path> status=... per file | technical | apply | auto (apply) | low | CI-parseable output; future tooling. |

Operator decisions: F23 apply, F24 apply, F31 apply. All 10 findings approved.

### Top themes (Round 2)
1. **Substitution correctness** — hard format rule (`{{...}}`), scoping (`substituteAt !== "never"`), idempotency invariant.
2. **New file handling** — post-adoption framework additions now have explicit write-and-track logic.
3. **Lifecycle enforcement** — `.framework-new` startup scan, missing state.json exits cleanly, submodule dirty = block.
4. **CLI contract sharpening** — `--check` / `--strict` split; `--doctor` claim downgraded to divergence-detection only.
5. **Hook identity + ordering** — command path = identity; replace on match; stable ordering across syncs.

### Applied (auto-applied + user-approved, Round 2)

**Auto-applied (technical):**
- [auto] F25: Added rename hint to removedFiles loop (step 8 pseudocode) — prints `INFO: possible rename` when removed + new paths are similar
- [auto] F26: Added startup scan (step 0 pseudocode) — exits on unresolved `.framework-new` files unless `--force`
- [auto] F27: Added hook identity rule to §4.6 — command path = identity; replace on match; stable framework-first ordering; unit-tested
- [auto] F28: Updated `--doctor` flag description and §9 risk row — detects divergence only, cannot reconstruct provenance; missing state.json exits with treat-all-as-customised default
- [auto] F29: Added submodule cleanliness check (step 6 pseudocode) — uncommitted changes → block; detached HEAD → allowed; branch mismatch → warning
- [auto] F30: Added pinned-checkout command examples to §4.7 — `git -C .claude-framework checkout v2.1.0` with explicit note against `branch = v2.1.0` in `.gitmodules`
- [auto] F32: Added structured log line (`SYNC file=<path> status=...`) to each step 7/8 operation
- [auto] Integrity check: all §4.6 cross-references intact; step 7/8 log-line reference correct; §8 migration step-7 reference unaffected

**User-approved:**
- [user] F23: Added Substitution engine rules block (§4.5) — 4 hard invariants: `{{PLACEHOLDER_NAME}}` format, substituteAt scoping, idempotency (no nested placeholders), substitution applied to `.framework-new` too
- [user] F24: Added new-file check (step 7d pseudocode) — file absent from state.files or not on disk → write + add to state; respects syncIgnore; never treated as customised
- [user] F31: Split `--check` and `--strict` in flags table; updated §11.3 description to match

---

## Round 3 — 2026-05-04T02:30:00Z

### ChatGPT Feedback (raw)

> Overall verdict: "you are now ready to implement Phase A"
>
> 1. 🔴 --adopt ambiguity — spec says "--adopt copies all managed files fresh" but self-adoption (migration step 7) requires non-destructive behaviour (file already exists → hash only, don't overwrite). The two descriptions conflict.
> 2. Eligible for update condition missing — step 7g jumps straight to writing without checking if lastAppliedFrameworkVersion < current. An already-synced file (clean hash, same version) would be needlessly re-written.
> 3. Partial-sync atomicity — state.json updated file-by-file during sync; if interrupted mid-run, state is partially-written and diverges from what was actually applied.
> 4. New-file vs existing-untracked distinction — step 7d's "OR target file does not exist" branch catches both "not in state and not on disk" (new) and "not in state but on disk" (pre-existing) — second case should be treated as customised, not new.
> 5. .framework-new overwrite behaviour undefined — if sync runs again with an unresolved .framework-new still present (operator ran --force), the old .framework-new is silently replaced; spec doesn't mention this.
> 6. Substitution validation scope — idempotency rule says "enforce at adoption time" but doesn't say validation also runs on every sync. If a value is edited in state.json between runs, it could corrupt subsequent syncs.
> 7. Manifest mode-change not handled — if a file transitions from "sync" to "adopt-only" between framework versions, sync has no rule for what happens to an existing state entry.
> 8. Changelog parsing fallback — step 9 "print summary" assumes CHANGELOG exists and is parseable; no fallback if it's missing or malformed.
> 9. Missing risk row: operator forgets to re-run sync after resolving .framework-new. Merges the two versions, deletes .framework-new, but never re-runs — state.json hash stays stale. --doctor could detect this (content ≠ lastAppliedHash AND no .framework-new sibling).

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F33: --adopt must be non-destructive (exists → hash+state; missing → write+state) | technical-escalated (high) | apply | user: apply | high | Conflict between flag description and migration step 7 self-adoption behaviour. |
| F34: Add lastAppliedFrameworkVersion eligibility check before writing in step 7g | technical | apply | auto (apply) | medium | Prevents needless re-writes when file already synced to current version. |
| F35: Write all files first, then write state.json atomically (.tmp → rename) | technical | apply | auto (apply) | high | Interrupted syncs leave state partially-written without this; re-run idempotency requires it. |
| F36: Split step 7d: "not in state AND not on disk" → new; "not in state BUT on disk" → customised | technical | apply | auto (apply) | high | Pre-existing untracked files should not be overwritten; silently correct wrong behaviour. |
| F37: .framework-new overwrite: overwrite silently, print notice if replaced | technical | apply | auto (apply) | low | Defines behaviour when --force used with pending merges. |
| F38: Substitution validation runs at --adopt AND every sync (not just adoption) | technical | apply | auto (apply) | medium | State.json values may be edited between runs; catch corrupt values before file writes. |
| F39: Mode-change (sync → adopt-only): mark adoptedOwnership=true in state, log transition | technical | apply | auto (apply) | medium | Without this, a mode-changed file falls through to regular sync logic incorrectly. |
| F40: Changelog fallback: if CHANGELOG missing/unparseable, warn and continue | technical | apply | auto (apply) | low | Sync should not fail on a non-critical diagnostic step. |
| F41: Add risk row (operator forgets re-run) + --doctor detects content≠hash AND no .framework-new | technical | apply | auto (apply) | medium | Closes the most common post-resolution footgun; adds targeted --doctor detection. |

Operator decision: F33 apply (user implicitly approved via "implement anything else important?" + "after you've done all of that").

### Top themes (Round 3)
1. **Non-destructive idempotency** — --adopt (F33), atomic state.json (F35), untracked-file case (F36).
2. **Edge-case completeness** — .framework-new overwrite (F37), mode transitions (F39), changelog fallback (F40).
3. **Observability tightening** — substitution validation every run (F38), --doctor unconfirmed-resolution detection (F41).

### Applied (auto-applied + user-approved, Round 3)

**Auto-applied (technical):**
- [auto] F34: Added `lastAppliedFrameworkVersion === current` early-exit check in step 7g before writing
- [auto] F35: Rewrote step 10 to write .framework-state.json.tmp → atomically rename; added "never partially-written" INVARIANT
- [auto] F36: Split step 7d into two branches: (1) not in state AND not on disk → new; (2) not in state AND on disk → existing-untracked → customised
- [auto] F37: Added "(overwrites silently if already exists; prints notice if replaced)" to .framework-new write in step 7h
- [auto] F38: Changed "Enforce at adoption time" → "Enforce at adoption time and on every sync run" in substitution engine rules §4.5
- [auto] F39: Added step 7b2 MODE CHANGE CHECK — sync→adopt-only transition marks adoptedOwnership=true and emits ownership-transferred
- [auto] F40: Added fallback warning to step 9 — WARN if CHANGELOG missing or unparseable; continue without failing
- [auto] F41: (a) Expanded `--doctor` flag description: detects (a) content≠hash and (b) content≠hash AND no .framework-new (unconfirmed resolution); (b) added new risk row to §9: operator forgets re-run after merge resolution

**User-approved:**
- [user] F33: Rewrote `--adopt` flag description to be non-destructive (file exists → hash+state only; file missing → write+state); aligns with migration step 7 self-adoption behaviour already described correctly in §8
