interface PriorityPillProps {
  priority: string;
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  normal: 'bg-slate-100 text-slate-600',
  low: 'bg-slate-100 text-slate-500',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export default function PriorityPill({ priority }: PriorityPillProps) {
  const style = PRIORITY_STYLES[priority] ?? 'bg-slate-100 text-slate-600';
  const label = PRIORITY_LABELS[priority] ?? priority;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
