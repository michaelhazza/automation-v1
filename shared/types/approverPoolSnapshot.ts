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

export function poolFingerprint(snapshot: ApproverPoolSnapshot): string {
  // sha256(sorted joined IDs).slice(0,16) — 64 bits, collision-negligible at pool scale
  // Uses SubtleCrypto in browser, crypto module in Node
  const sorted = [...snapshot].sort().join(',');
  // Simple deterministic hash for V1 (not cryptographic; just fingerprint for change detection)
  // FNV-1a 64-bit truncated to 16 hex chars
  let hash = BigInt('0xcbf29ce484222325');
  const FNV_PRIME = BigInt('0x100000001b3');
  const MASK = BigInt('0xffffffffffffffff');
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash ^ BigInt(sorted.charCodeAt(i))) * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

export function userInPool(snapshot: ApproverPoolSnapshot, userId: string): boolean {
  const normalised = userId.toLowerCase();
  return snapshot.includes(normalised);
}
