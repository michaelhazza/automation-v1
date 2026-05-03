// Shared singleton nonce store for GHL agency OAuth CSRF protection.
// ghl.ts writes; oauthIntegrations.ts validates + consumes.
// One-shot: nonce is deleted on first successful validation.
// TTL: 10 minutes from creation.

const NONCE_TTL_MS = 10 * 60 * 1000;

interface GhlOAuthState {
  orgId: string;
  expiresAt: number;
}

// Single-instance only: state is lost on process restart and invisible to other nodes.
// A user who completes OAuth mid-restart will receive invalid_state and must restart the flow.
// Replace with Redis/DB-backed store before running multi-instance or blue-green deployments.
const store = new Map<string, GhlOAuthState>();

export function setGhlOAuthState(nonce: string, orgId: string): void {
  // Prune expired entries on every write to prevent unbounded growth.
  const now = Date.now();
  for (const [key, val] of store) {
    if (val.expiresAt < now) store.delete(key);
  }
  store.set(nonce, { orgId, expiresAt: now + NONCE_TTL_MS });
}

/** Returns orgId if valid; null if missing, expired, or already consumed. */
export function consumeGhlOAuthState(nonce: string): string | null {
  const entry = store.get(nonce);
  if (!entry) return null;
  store.delete(nonce);
  if (entry.expiresAt < Date.now()) return null;
  return entry.orgId;
}
