const THROTTLE_MS = Number(process.env.SYSTEM_INCIDENT_THROTTLE_MS) || 1000;
const MAX_FINGERPRINTS = 50_000;

const lastSeenByFingerprint = new Map<string, number>();
let throttledCount = 0;
let mapEvictionCount = 0;

/** Returns true if the call is throttled (caller drops). */
export function checkThrottle(fingerprint: string): boolean {
  const now = Date.now();
  const last = lastSeenByFingerprint.get(fingerprint);
  if (last !== undefined && now - last < THROTTLE_MS) {
    throttledCount++;
    return true;
  }
  if (lastSeenByFingerprint.size >= MAX_FINGERPRINTS) {
    const oldest = lastSeenByFingerprint.keys().next().value;
    if (oldest !== undefined) {
      lastSeenByFingerprint.delete(oldest);
      mapEvictionCount++;
    }
  }
  lastSeenByFingerprint.set(fingerprint, now);
  return false;
}

export function getThrottledCount(): number { return throttledCount; }
export function getMapEvictionCount(): number { return mapEvictionCount; }

export function __resetForTest(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'integration') return;
  lastSeenByFingerprint.clear();
  throttledCount = 0;
  mapEvictionCount = 0;
}
