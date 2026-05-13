# ADR-0018: Overlay stack ownership — central manager

**Status:** proposed
**Date:** 2026-05-13
**Domain:** frontend
**Supersedes:** _n/a_
**Superseded by:** _n/a_

## Context

Modal, Drawer, and overlay coordination today is convention-driven: each consuming page wires its own `<Modal>` / `<Drawer>` and remembers to honour the reference-counted scroll-lock primitive at `client/src/lib/overlayScrollLock.ts`. The consolidation-foundation review (CONSOL-FND-DEF-5 in the legacy backlog) surfaced that this works until two overlays stack — at which point ownership of focus trap, scroll lock release, ESC handling, and z-index becomes ambiguous. The current contract is implicit; future consolidation specs (notably the Govern sub-pages and any drawer-from-modal flows) will inherit whatever decision we make here.

## Decision

We will own overlay stacking with a **central `OverlayStackManager` primitive** that any modal-, drawer-, or sheet-style component must register with on mount and deregister on unmount. The manager exposes: (a) a stable z-index assignment based on stack depth, (b) ESC-key routing to the top-most overlay only, (c) scroll-lock acquisition/release reference-counted across all registrants, (d) focus-trap ownership transfer (top-most owns the trap; lower overlays restore focus on close). Existing primitives (`Modal`, `Drawer`, `Sheet` under `client/src/components/`) will be migrated to consume the manager; new overlay primitives must register with it from inception. Direct DOM manipulation of `document.body.style.overflow` outside the manager is prohibited.

## Consequences

- **Positive:**
  - One source of truth for overlay stacking; removes per-component scroll-lock bookkeeping.
  - Stacking semantics become testable in isolation (manager API, not visual).
  - Future consolidation work (Govern, Workflows Studio, Agent Workspace) inherits a stable contract.
- **Negative:**
  - One-time migration of every existing overlay component to the manager API.
  - Adds one indirection layer between the page author and the DOM.
- **Neutral:**
  - The existing `overlayScrollLock.ts` primitive becomes an implementation detail of the manager; its public API stays as a thin facade for non-manager consumers (rare) and tests.

## Alternatives considered

- **Keep the convention-driven approach** — rejected. Already produces ambiguity at depth 2; will degrade further as more drawer-in-modal flows ship.
- **Per-overlay-kind manager (one for modals, one for drawers)** — rejected. The cross-kind interactions (drawer-on-modal, sheet-on-drawer) are exactly the cases the manager exists to handle.

## When to revisit

Re-open when **any one** of these triggers fires:
- A real overlay-stacking bug ships to production that the manager would have prevented (validates the decision).
- The DOM hosting changes (e.g. moving overlays to a portal root or web component shadow root) such that the manager's z-index strategy no longer applies.

## References

- Stub spec: _(none yet — manager design lands as part of the next consolidation sprint)_
- Related primitive: `client/src/lib/overlayScrollLock.ts`
- Related ADR: ADR-0007 (consolidation-build-page-retirement)
