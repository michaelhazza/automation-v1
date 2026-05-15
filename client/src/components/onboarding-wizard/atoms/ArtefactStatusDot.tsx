export function ArtefactStatusDot({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>
    );
  }
  if (status === 'skipped') {
    return <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-slate-400 text-[9px] font-bold">S</span>;
  }
  return <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200" />;
}
