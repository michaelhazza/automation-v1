interface StatusPillProps {
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-green-100 text-green-800',
  pending_internal: 'bg-yellow-100 text-yellow-800',
  waiting_on_customer: 'bg-blue-100 text-blue-800',
  unknown_provider_status: 'bg-red-100 text-red-800',
  closed: 'bg-slate-100 text-slate-600',
  resolved: 'bg-slate-100 text-slate-600',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  pending_internal: 'Pending Internal',
  waiting_on_customer: 'Waiting on Customer',
  unknown_provider_status: 'Unknown',
  closed: 'Closed',
  resolved: 'Resolved',
};

export default function StatusPill({ status }: StatusPillProps) {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
