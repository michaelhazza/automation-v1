interface ConfidenceBadgeProps {
  confidence: number;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? 'text-green-700 bg-green-50' : pct >= 50 ? 'text-yellow-700 bg-yellow-50' : 'text-red-700 bg-red-50';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {pct}% confident
    </span>
  );
}
