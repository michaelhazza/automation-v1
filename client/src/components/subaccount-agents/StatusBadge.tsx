const STATUS_CLS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-orange-50 text-orange-800',
  draft: 'bg-slate-100 text-slate-600',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${STATUS_CLS[status] ?? STATUS_CLS.draft}`}>
      {status}
    </span>
  );
}
