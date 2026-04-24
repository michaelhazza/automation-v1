/**
 * SparklineChartPure.ts
 *
 * Pure computation helpers for SparklineChart.
 * No React / DOM dependencies — fully testable via npx tsx.
 *
 * Spec: ClientPulse UI simplification §3.2
 */

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineComputeResult {
  isEmpty: boolean;
  points: SparklinePoint[];
  /** Space-joined "x,y" pairs suitable for SVG <polyline points="..."> */
  pointsAttr: string;
  /** Last computed point — used for the terminal dot; undefined when isEmpty */
  last: SparklinePoint | undefined;
}

/**
 * Clamp a value to [min, max].
 */
export function clampValue(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Compute SVG polyline points for an array of health score values.
 *
 * Rules:
 *   - values outside [0, 100] are clamped before rendering
 *   - x is evenly spaced: (i / (n-1)) * width  (single value: width / 2)
 *   - y = height - (clamp(v, 0, 100) / 100) * height
 *     (100 → top of SVG at y=0; 0 → bottom at y=height)
 */
export function computePoints(
  values: number[],
  width: number,
  height: number,
): SparklineComputeResult {
  if (values.length === 0) {
    return { isEmpty: true, points: [], pointsAttr: '', last: undefined };
  }

  const n = values.length;

  const points: SparklinePoint[] = values.map((v, i) => {
    const clamped = clampValue(v, 0, 100);
    const rawX = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const rawY = height - (clamped / 100) * height;
    // Round to 4dp to avoid IEEE 754 noise in the SVG points attribute
    const x = Math.round(rawX * 10000) / 10000;
    const y = Math.round(rawY * 10000) / 10000;
    return { x, y };
  });

  const pointsAttr = points.map((p) => `${p.x},${p.y}`).join(' ');
  const last = points[points.length - 1];

  return { isEmpty: false, points, pointsAttr, last };
}
