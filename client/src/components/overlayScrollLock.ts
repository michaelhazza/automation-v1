// client/src/components/overlayScrollLock.ts (NEW, internal helper)
//
// Reference-counted scroll lock shared by all overlays (Modal, Drawer, etc.).
// Uses Symbol keys on `window` so the counter survives HMR and is isolated from
// any other scroll-lock libraries the app might load.

const COUNTER_KEY = Symbol.for('automation-os.overlay-scroll-lock.counter');
const SNAPSHOT_KEY = Symbol.for('automation-os.overlay-scroll-lock.snapshot');

interface LockWindow {
  [COUNTER_KEY]?: number;
  [SNAPSHOT_KEY]?: string;
}

// INVARIANT: COUNTER_KEY MUST NEVER be negative. Math.max(0, ...) defends against
// double-unmount or HMR-induced cleanup drift. If the counter ever drifts below zero,
// the snapshot may be lost and `overflow` resets to '' instead of the original value.
//
// INVARIANT: overlayScrollLock assumes exclusive ownership of document.body.style.overflow
// while any overlay is mounted. External mutation of `document.body.style.overflow` during
// lock lifetime is undefined behaviour — the snapshot restored on final release will revert
// the external change. Do NOT mutate body overflow from outside this helper.
export function acquireScrollLock(): void {
  const w = window as unknown as LockWindow;
  const current = Math.max(0, w[COUNTER_KEY] ?? 0);
  const next = current + 1;
  if (next === 1) {
    w[SNAPSHOT_KEY] = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  w[COUNTER_KEY] = next;
}

export function releaseScrollLock(): void {
  const w = window as unknown as LockWindow;
  // Clamp to zero defensively: a stray release without acquire (e.g. test teardown calling
  // cleanup twice) MUST NOT push the counter into negative territory.
  const current = Math.max(0, w[COUNTER_KEY] ?? 0);
  if (current <= 1) {
    document.body.style.overflow = w[SNAPSHOT_KEY] ?? '';
    delete w[SNAPSHOT_KEY];
    delete w[COUNTER_KEY];
  } else {
    w[COUNTER_KEY] = current - 1;
  }
}
