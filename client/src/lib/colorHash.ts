// client/src/lib/colorHash.ts
//
// Deterministic palette hash using 32-bit FNV-1a.
// Pure function: identical input always produces identical output.

export type Palette = ReadonlyArray<string>;

export const DEFAULT_WORKSPACE_PALETTE: Palette = [
  'indigo',
  'amber',
  'emerald',
  'red',
  'sky',
  'slate',
] as const;

/**
 * Maps an arbitrary string to a palette entry using FNV-1a (32-bit).
 * Empty string returns palette[0] without throwing.
 */
export function hashToColor(input: string, palette: Palette = DEFAULT_WORKSPACE_PALETTE): string {
  // Empty string: return palette[0] per spec (no hash computed).
  if (input.length === 0) return palette[0];

  // FNV-1a 32-bit constants
  const FNV_OFFSET_BASIS = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;

  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply using unsigned 32-bit arithmetic: split into 16-bit halves to avoid
    // floating-point precision loss on values beyond Number.MAX_SAFE_INTEGER.
    hash = (((hash & 0xffff) * FNV_PRIME) + (((hash >>> 16) * FNV_PRIME) << 16)) >>> 0;
  }

  return palette[hash % palette.length];
}
