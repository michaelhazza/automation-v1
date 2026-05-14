import { useEffect, useRef, useState } from 'react';
import type { TaskProjection } from '../../../../shared/types/taskProjection';

interface CostSummary {
  subscriptionMediatedCents: number;
  sandboxComputeCents: number;
  totalLinks: number;
}

interface ActivityPaneProps {
  projection: TaskProjection;
  operatorRunStatus?: string | null;
  costSummary?: CostSummary | null;
}

export function ActivityPane({ projection, operatorRunStatus, costSummary }: ActivityPaneProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const count = projection.activityEvents.length;
    if (count > prevCountRef.current) {
      if (isUserScrolledUp) {
        setUnseenCount(c => c + (count - prevCountRef.current));
      } else {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
      prevCountRef.current = count;
    }
  }, [projection.activityEvents, isUserScrolledUp]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setIsUserScrolledUp(!atBottom);
    if (atBottom) setUnseenCount(0);
  };

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    setUnseenCount(0);
    setIsUserScrolledUp(false);
  };

  if (collapsed) {
    return (
      <div
        style={{ width: 36, minWidth: 36 }}
        className="flex flex-col items-center justify-between py-2 border-r border-slate-200 bg-slate-50 cursor-pointer"
        onClick={() => setCollapsed(false)}
      >
        <span
          className="text-[10px] text-slate-400 rotate-180"
          style={{ writingMode: 'vertical-rl' }}
        >
          Activity
        </span>
      </div>
    );
  }

  // Fallback-engaged amber inline row (r6).
  const fallbackRow =
    operatorRunStatus === 'fallback_engaged' ? (
      <div className="text-[12px] text-amber-700 py-0.5 px-1 bg-amber-50 rounded border border-amber-200 my-0.5">
        <span className="font-medium">Fallback engaged.</span> Switched to API key for the remainder
        of this session.
      </div>
    ) : null;

  return (
    <div className="flex flex-col h-full relative" style={{ minWidth: 0 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 text-[12px] font-semibold text-slate-600">
        <span>Activity</span>
        <button onClick={() => setCollapsed(true)} className="text-slate-400 hover:text-slate-600">&#8212;</button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1"
      >
        {fallbackRow}
        {projection.activityEvents.length === 0 ? (
          <p className="text-[12px] text-slate-400 text-center mt-4">No activity yet.</p>
        ) : (
          projection.activityEvents.map(ev => (
            <div key={ev.id} className="text-[12px] text-slate-600 py-0.5">
              <span className="text-slate-400 mr-1">
                {new Date(ev.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              {ev.summary}
            </div>
          ))
        )}
      </div>
      {unseenCount > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-indigo-600 text-white text-[11px] rounded-full shadow-md hover:bg-indigo-700"
        >
          {unseenCount} new event{unseenCount !== 1 ? 's' : ''}
        </button>
      )}
      {costSummary && (
        <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 space-y-0.5">
          <div>{costSummary.totalLinks} session{costSummary.totalLinks !== 1 ? 's' : ''} total</div>
          {costSummary.subscriptionMediatedCents > 0 && (
            <div>Subscription: ${(costSummary.subscriptionMediatedCents / 100).toFixed(2)}</div>
          )}
          {costSummary.sandboxComputeCents > 0 && (
            <div>Compute: ${(costSummary.sandboxComputeCents / 100).toFixed(2)}</div>
          )}
        </div>
      )}
    </div>
  );
}
