// Inline SVG sparkline — no charting library. Accepts already-normalised
// values in [0, 1]; the producer (systemPnlService.fetchOrgSparkline) divides
// each day's cost by the series max. Missing days collapse to 0.

interface Props {
  values: number[];
  width?: number;
  height?: number;
}

export default function PnlSparkline({ values, width = 80, height = 20 }: Props) {
  if (values.length === 0) {
    return <span className="text-slate-300">—</span>;
  }
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - Math.max(0, Math.min(1, v)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block align-middle">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        className="text-indigo-500"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
