interface ThreadMessageProps {
  direction: 'inbound' | 'outbound';
  visibility: 'public' | 'internal';
  body: string;
  authorName?: string | null;
  createdAt: string;
}

export default function ThreadMessage({ direction, visibility, body, authorName, createdAt }: ThreadMessageProps) {
  const isInternal = visibility === 'internal';
  const isOutbound = direction === 'outbound';

  const containerClass = isOutbound
    ? 'ml-8 bg-white border border-slate-200'
    : 'mr-8 bg-slate-50 border border-slate-100';

  const internalBadge = isInternal ? (
    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700">
      Internal
    </span>
  ) : null;

  return (
    <div className={`rounded-lg p-3 mb-2 ${containerClass}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-500">
          {authorName ?? (isOutbound ? 'Agent' : 'Customer')}
          {internalBadge}
        </span>
        <span className="text-xs text-slate-400">
          {new Date(createdAt).toLocaleString()}
        </span>
      </div>
      <p className="text-sm text-slate-800 whitespace-pre-wrap">{body}</p>
    </div>
  );
}
