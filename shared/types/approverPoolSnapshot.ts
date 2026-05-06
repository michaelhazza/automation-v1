// Branded UUID array — normalised (lowercase, deduped, validated)
export type ApproverPoolSnapshot = readonly string[] & { readonly __brand: 'ApproverPoolSnapshot' };

export class InvalidApproverPoolSnapshotError extends Error {
  constructor(reason: string) {
    super(`Invalid approver pool snapshot: ${reason}`);
    this.name = 'InvalidApproverPoolSnapshotError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normaliseApproverPoolSnapshot(raw: unknown): ApproverPoolSnapshot {
  if (!Array.isArray(raw)) {
    throw new InvalidApproverPoolSnapshotError('input must be an array');
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new InvalidApproverPoolSnapshotError(`each element must be a string, got ${typeof item}`);
    }
    const lower = item.toLowerCase();
    if (!UUID_RE.test(lower)) {
      throw new InvalidApproverPoolSnapshotError(`invalid UUID: ${item}`);
    }
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(lower);
    }
  }
  return result as unknown as ApproverPoolSnapshot;
}

// Spec §8.2 — fingerprint = sha256(sortedJoinedIds).slice(0, 16). 64 bits of
// entropy is collision-negligible at the pool sizes we care about (typical
// approval pools are <50 users; even at 1M pools the birthday collision
// probability is < 1e-7).
//
// Computed via Node's crypto module on the server. The same function runs in
// the browser via SubtleCrypto when needed; client paths that need a
// fingerprint receive it from the server in the broadcast envelope and do not
// recompute, so the sync vs. async split does not matter at call sites today.
import { createHash } from 'node:crypto';

export function poolFingerprint(snapshot: ApproverPoolSnapshot): string {
  const sorted = [...snapshot].sort().join(',');
  return createHash('sha256').update(sorted, 'utf8').digest('hex').slice(0, 16);
}

export function userInPool(snapshot: ApproverPoolSnapshot, userId: string): boolean {
  const normalised = userId.toLowerCase();
  return snapshot.includes(normalised);
}
