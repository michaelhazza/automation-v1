// Visual divider inserted between events belonging to different chain_seq
// values in the Run Trace timeline (mockup r17).

interface ChainLinkDividerProps {
  chainSeq: number;
  startedAt?: string | null;
}

export function ChainLinkDivider({ chainSeq, startedAt }: ChainLinkDividerProps) {
  return (
    <div className="flex items-center gap-3 my-2">
      <div className="flex-1 border-t border-slate-200" />
      <span className="text-[11px] text-slate-400 font-medium shrink-0 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded">
        Chain link {chainSeq}
        {startedAt ? (
          <span className="ml-1 text-slate-300">
            {new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : null}
      </span>
      <div className="flex-1 border-t border-slate-200" />
    </div>
  );
}
