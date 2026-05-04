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
