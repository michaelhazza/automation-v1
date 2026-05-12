import { Link } from 'react-router-dom';
import type { HomeWidget } from '../../hooks/useHomeWidgets';

const SHIMMER_CLS =
  'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md';

function Skeleton({ className }: { className?: string }) {
  return <div className={`${SHIMMER_CLS} ${className ?? ''}`} />;
}

interface PersonalZoneCardProps {
  widget: HomeWidget;
  isLoading?: boolean;
}

export default function PersonalZoneCard({ widget, isLoading }: PersonalZoneCardProps) {
  if (isLoading) {
    return (
      <div className="bg-white border border-indigo-100 rounded-xl p-5 shadow-sm min-w-[280px]">
        <Skeleton className="h-5 w-32 mb-3" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-3/4 mb-4" />
        <Skeleton className="h-8 w-24" />
      </div>
    );
  }

  const { agentName, data } = widget;
  const agentId = widget.agentId;

  const primaryLine =
    data?.widgetType === 'summary_card'
      ? data.summary
      : data?.widgetType === 'queue_card'
        ? `${data.count} item${data.count === 1 ? '' : 's'} waiting`
        : data?.widgetType === 'metric_card'
          ? `${data.value}${data.unit ? ' ' + data.unit : ''}`
          : null;

  const secondaryLines: string[] =
    data?.widgetType === 'queue_card'
      ? data.items.slice(0, 2).map((i) => i.label)
      : [];

  const openLink = `/personal/${agentId}`;

  const hasError = data === null;

  return (
    <div className="bg-gradient-to-br from-white to-slate-50 border border-indigo-200 rounded-xl p-5 shadow-sm min-w-[280px] flex flex-col gap-3">
      <div className="flex items-center gap-3 pb-3 border-b border-indigo-50">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
          {agentName.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-slate-900 truncate">{agentName}</div>
          <div className="text-xs text-slate-500">Personal agent</div>
        </div>
        <Link
          to={openLink}
          className="text-xs font-semibold text-indigo-600 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 transition-colors flex-shrink-0"
        >
          Open
        </Link>
      </div>

      <div className="flex-1">
        {hasError ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            Status unavailable
          </span>
        ) : primaryLine ? (
          <p className="text-sm text-slate-700 leading-relaxed">{primaryLine}</p>
        ) : (
          <p className="text-sm text-slate-400 italic">No data yet</p>
        )}

        {secondaryLines.length > 0 && (
          <ul className="mt-2 space-y-1">
            {secondaryLines.map((line, i) => (
              <li key={i} className="text-xs text-slate-500 truncate">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
