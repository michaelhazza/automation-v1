/**
 * ARIA live region throttle helper.
 * One announcement per 5s per surface; bursts collapse to "N updates in the last minute".
 *
 * Agent Workspace Chunk 9.
 */

const lastAnnouncedAt = new Map<string, number>();
const pendingCount = new Map<string, number>();

let liveRegion: HTMLElement | null = null;

function getLiveRegion(): HTMLElement {
  if (liveRegion && document.body.contains(liveRegion)) return liveRegion;

  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.style.position = 'absolute';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.padding = '0';
  el.style.overflow = 'hidden';
  el.style.clip = 'rect(0,0,0,0)';
  el.style.whiteSpace = 'nowrap';
  el.style.border = '0';
  document.body.appendChild(el);
  liveRegion = el;
  return el;
}

function announce(message: string): void {
  const el = getLiveRegion();
  // Toggle content to force re-announcement even if the same string is set
  el.textContent = '';
  // Defer to allow the DOM mutation to be observed as a change
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}

/**
 * Throttle live region announcements to one per 5s per surfaceId.
 * Burst events collapse to "N updates in the last minute".
 */
export function announceLiveUpdate(surfaceId: string, message: string): void {
  const THROTTLE_MS = 5_000;
  const now = Date.now();
  const last = lastAnnouncedAt.get(surfaceId) ?? 0;

  if (now - last < THROTTLE_MS) {
    pendingCount.set(surfaceId, (pendingCount.get(surfaceId) ?? 0) + 1);
    return;
  }

  const pending = pendingCount.get(surfaceId) ?? 0;
  const text = pending > 0 ? `${pending + 1} updates in the last minute` : message;

  pendingCount.set(surfaceId, 0);
  lastAnnouncedAt.set(surfaceId, now);
  announce(text);
}
