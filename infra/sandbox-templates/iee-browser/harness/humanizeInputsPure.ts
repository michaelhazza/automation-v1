// humanizeInputsPure.ts
// Pure deterministic input-timing generators for the humanize primitive.
// Spec §4.3, §6.2, §11.1, §19.3

import type { HumanizeOptions, HumanizeProfile } from '../../../../shared/types/humanize.js';

export type { HumanizeProfile } from '../../../../shared/types/humanize.js';
// Re-export for harness consumers

export interface Point {
  x: number;
  y: number;
}

// Per-profile latency constants (architect-pick item 2)
// light:    50ms median / 90ms p99
// balanced: 150ms median / 280ms p99
// heavy:    380ms median / 700ms p99
const PROFILE_PARAMS: Record<HumanizeProfile, { median: number; p99: number }> = {
  light:    { median: 50,  p99: 90  },
  balanced: { median: 150, p99: 280 },
  heavy:    { median: 380, p99: 700 },
};

// Mulberry32: deterministic 32-bit seeded RNG
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff;
  };
}

// Cubic Bezier evaluation at parameter t ∈ [0,1]
function cubicBezier(
  p0: Point, p1: Point, p2: Point, p3: Point, t: number
): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Generate a mouse curve from `from` to `to` using a Bezier path.
 * Deterministic: same (from, to, profile, seed) → same output.
 */
export function generateMouseCurve(
  from: Point,
  to: Point,
  profile: HumanizeProfile,
  seed: number
): Point[] {
  if (from.x === to.x && from.y === to.y) return [from];

  const rng = mulberry32(seed);
  const params = PROFILE_PARAMS[profile];
  const steps = Math.max(3, Math.round(params.median / 10));

  // Generate two control points with slight randomness
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const jitter = params.median * 0.3;

  const p1: Point = { x: midX + (rng() - 0.5) * jitter, y: midY + (rng() - 0.5) * jitter };
  const p2: Point = { x: midX + (rng() - 0.5) * jitter, y: midY + (rng() - 0.5) * jitter };

  const curve: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    curve.push(cubicBezier(from, p1, p2, to, i / steps));
  }
  return curve;
}

/**
 * Generate per-keystroke typing intervals (ms) for `text`.
 * Deterministic: same (text, profile, seed) → same output.
 */
export function generateTypingIntervals(
  text: string,
  profile: HumanizeProfile,
  seed: number
): number[] {
  if (text.length === 0) return [];

  const rng = mulberry32(seed);
  const params = PROFILE_PARAMS[profile];

  return Array.from({ length: text.length }, () => {
    // Log-normal-ish distribution: median ± variance
    const base = params.median;
    const variance = (params.p99 - params.median) / 3;
    const raw = base + (rng() - 0.5) * 2 * variance;
    return Math.max(10, Math.round(raw));
  });
}

/**
 * Generate scroll momentum intervals (ms) for a scroll of `delta` pixels.
 * Deterministic: same (delta, profile, seed) → same output.
 */
export function generateScrollMomentum(
  delta: number,
  profile: HumanizeProfile,
  seed: number
): number[] {
  if (delta === 0) return [];

  const rng = mulberry32(seed);
  const params = PROFILE_PARAMS[profile];
  const steps = Math.max(2, Math.round(Math.abs(delta) / 100));

  return Array.from({ length: steps }, () => {
    const base = params.median * 0.5;
    const variance = params.median * 0.3;
    const raw = base + (rng() - 0.5) * 2 * variance;
    return Math.max(10, Math.round(raw));
  });
}

// Validate HumanizeOptions; throw on invalid input
export function validateOptions(opts: HumanizeOptions): void {
  if (!['light', 'balanced', 'heavy'].includes(opts.profile)) {
    throw new Error(`humanizeInputsPure: invalid options: profile must be 'light'|'balanced'|'heavy', got '${opts.profile}'`);
  }
  if (!Number.isInteger(opts.seed) || opts.seed < 0) {
    throw new Error(`humanizeInputsPure: invalid options: seed must be a non-negative integer, got ${opts.seed}`);
  }
}

// Export profile params for testing
export { PROFILE_PARAMS };
