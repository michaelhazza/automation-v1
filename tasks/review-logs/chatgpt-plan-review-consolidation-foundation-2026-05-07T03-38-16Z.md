# chatgpt-plan-review — consolidation-foundation

**Date:** 2026-05-07
**Plan:** tasks/builds/consolidation-foundation/plan.md
**Mode:** manual
**Coordinator:** feature-coordinator (Phase 2 Step 4)
**Branch:** claude/learn-harbour-ui-B4k7a
**Plan version reviewed:** v1 (commit `5d4055ee`)

---

## Round 1

**Status:** complete — APPROVE with minor tightenings.
**ChatGPT verdict:** Plan is tight, implementation-ready, no blockers, no architectural issues, no scope leaks. Architecture decisions (AppRoute branding, scroll-lock singleton, pure-function extraction) are sound.

### High-impact tightenings raised by ChatGPT

| # | Topic | Verdict | Action |
|---|---|---|---|
| T1 | `buildRoute` silent placeholder leakage | Apply | Dev-only `console.warn` when result still contains an unresolved `:param` segment. Production keeps placeholder behaviour (Phase 0 acceptable). |
| T2 | Scroll-lock counter drift under unexpected teardown | Apply | `Math.max(0, counter)` clamp on both acquire and release paths; explicit `INVARIANT: counter MUST NEVER be negative` comment. |
| T3 | Sort stability dependency soft-documented | Apply | Explicit `INVARIANT: relies on V8 stable sort` comment in `applySortAndFilters` JSDoc. Test already covers stability across sort flips. |
| T4 | `persistKey` namespace collision risk | Apply (documentation route) | `INVARIANT: persistKey MUST be globally unique per table usage` documented on the `persistKey` prop. Recommended pattern `<page>-<table-purpose>`. Auto-prefixing route was rejected — two pages may legitimately share table state, and route-coupling adds fragility. |
| T5 | `switchWorkspace` reload side-effect clarity | Apply | `if (!clientId) return;` defensive guard; full JSDoc moved into the contract block stating verbatim "this is the ONLY allowed `window.location.reload()` call site for workspace changes". |
| T6 | `buildNavItems` ordering invariant unlocked | Apply | Explicit invariant comment locking group order: `top → work → projects → agents → company → clientpulse → organisation → platform → footer`. Reordering fails the C5 visual-diff criterion. |

### Medium-risk observations (no change required, ChatGPT confirmed correct)

- ViewMode derivation is clean (no hidden state, no persistence, derived not stored).
- Pure-function extraction matches existing patterns (`runStatusPure`, etc.).
- Chunking is well balanced; C2 and C5 are at the edge but logically atomic.
- No backend bleed.

### Intentionally correct (do not change)

- `AppRoute` branding trade-off vs literal unions.
- `Symbol.for` usage for HMR resilience.
- No Zustand / context (derived state).
- Factory pattern for sidebar (necessary, not over-engineered).
- Debounced localStorage (right balance).

### Outcome

All six tightenings applied to `tasks/builds/consolidation-foundation/plan.md`. Plan version bumped to **v2 (post-ChatGPT-review tightenings)**. No scope expansion; every edit was surgical.

**Round 1 verdict:** APPROVED with tightenings applied. Proceed to Round 2 if operator wants further passes; otherwise plan-review loop is complete.

---

## Round 2

**Status:** complete — DONE.
**ChatGPT verdict:** No blockers, no architectural risks, no hidden coupling, no spec drift. Three optional micro-tightenings raised.

### Micro-tightenings raised by ChatGPT

| # | Topic | Verdict | Action |
|---|---|---|---|
| T7 | `buildRoute` partial-param strict mode | **Skip — redundant** | The Round-1 dev-warn regex `(?:^|\/):[A-Za-z_][A-Za-z0-9_]*` runs on the post-substitution output string. `buildRoute('/foo/:id/:subId', { id: '1' })` produces `/foo/1/:subId` which trips the existing warn. The proposed pattern-vs-provided diff is functionally equivalent. ChatGPT explicitly flagged this as "you don't need this". |
| T8 | Scroll-lock external-mutation invariant | Apply | Comment-only addition: `INVARIANT: overlayScrollLock assumes exclusive ownership of document.body.style.overflow while any overlay is mounted. External mutation during lock lifetime is undefined behaviour.` Prevents future devs from introducing conflicts. |
| T9 | `buildNavItems` test gap (org admin + activeClientId + viewMode='org') | Apply | Concrete assertion added: with `viewMode: 'org'` + `activeClientId` truthy, `expect(items.some(i => i.group === 'work')).toBe(false)` (and same for `projects`, `agents`). Closes the suppression-vs-activeClientId regression blind spot. |

### Strengths ChatGPT explicitly called out (no action — kept as-is)

- Branded routing without overengineering (string chaos vs full router abstraction both avoided).
- Scroll-lock counter + snapshot pattern done correctly.
- Pure-function isolation aligned with `invariants > verification` pattern.
- Sidebar factory over static config — correct call.
- No premature infra (no state libs, no overlay manager).

### Outcome

T8 and T9 applied. T7 skipped with rationale logged. Plan stays at v2 (these are micro-tightenings, not a version bump).

**Round 2 verdict:** DONE. Plan-review loop is complete. Proceed to plan gate (operator review of `tasks/builds/consolidation-foundation/plan.md`, then switch to Sonnet for execution).
