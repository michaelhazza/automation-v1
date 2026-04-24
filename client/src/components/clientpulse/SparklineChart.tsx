/**
 * SparklineChart.tsx
 *
 * Inline SVG sparkline for ClientPulse health score history.
 *
 * Spec: ClientPulse UI simplification §3.2
 *
 * colour prop must be a Tailwind text-* class (e.g. "text-rose-500").
 * It is applied via className on SVG elements so Tailwind's
 * text-* → stroke: currentColor mapping works. Never set a literal
 * hex/rgb colour here.
 */

import React from 'react';
import { computePoints } from './SparklineChartPure.js';

export interface SparklineChartProps {
  values: number[];
  /** Tailwind class — e.g. "text-rose-500" — applied to the polyline via className */
  colour: string;
  width?: number;
  height?: number;
  terminalDot?: boolean;
}

export function SparklineChart({
  values,
  colour,
  width = 90,
  height = 28,
  terminalDot = true,
}: SparklineChartProps): React.ReactElement {
  const { isEmpty, pointsAttr, last } = computePoints(values, width, height);

  if (isEmpty) {
    return <span className="text-slate-300">—</span>;
  }

  return (
    <svg width={width} height={height}>
      <polyline
        points={pointsAttr}
        className={colour}
        stroke="currentColor"
        fill="none"
        strokeWidth="1.5"
      />
      {terminalDot && last !== undefined && (
        <circle
          cx={last.x}
          cy={last.y}
          r={2.5}
          fill="currentColor"
          className={colour}
        />
      )}
    </svg>
  );
}

export default SparklineChart;
