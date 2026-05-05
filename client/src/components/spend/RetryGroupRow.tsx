import { useState } from 'react';
import type { RetryGroup } from './RetryGroupingPure.js';
import { formatSpendCardPure } from './formatSpendCardPure.js';

interface RetryGroupRowProps {
  group: RetryGroup;
}

const STATUS_STYLES: Record<string, string> = {
  settled:        'bg-green-100 text-green-800',
  shadow_settled: 'bg-slate-100 text-slate-600',
  blocked:        'bg-red-100 text-red-700',
  denied:         'bg-orange-100 text-orange-700',
  pending:        'bg-blue-100 text-blue-700',
  reserved:       'bg-indigo-100 text-indigo-700',
  failed:         'bg-red-100 text-red-700',
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * A collapsible row grouping charge attempts by intent_id.
 * Shows the most-recent attempt inline; expands to show all attempts.
 * Keyboard accessible: Enter/Space toggles expand.
 */
export default function RetryGroupRow({ group }: RetryGroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { latest, attempts, attemptCount } = group;
  const isMulti = attemptCount > 1;

  const toggle = () => {
    if (isMulti) setExpanded(p => !p);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };

  const latestFormatted = formatSpendCardPure({
    amountMinor: latest.amountMinor,
    currency: latest.currency,
    merchantId: latest.merchantId,
    merchantDescriptor: latest.merchantDescriptor,
  });

  return (
    <>
      <tr
        className={`border-b border-slate-100 transition-colors duration-75 ${isMulti ? 'cursor-pointer hover:bg-slate-50' : 'hover:bg-slate-50'}`}
        onClick={toggle}
        onKeyDown={handleKey}
        tabIndex={isMulti ? 0 : undefined}
        role={isMulti ? 'button' : undefined}
        aria-expanded={isMulti ? expanded : undefined}
      >
        <td className="px-4 py-2.5 text-[12.5px] text-slate-600 w-[140px] shrink-0">
          {new Date(latest.createdAt).toLocaleString()}
        </td>
        <td className="px-4 py-2.5 text-[12.5px] font-medium text-slate-800">
          <div className="flex items-center gap-2">
            {isMulti && (
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`text-slate-400 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
            {latestFormatted.merchantDisplay}
            {isMulti && (
              <span className="text-[11px] text-slate-400 font-normal">
                {attemptCount} attempts
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5 text-[12.5px] text-slate-700 text-right font-mono">
          {latestFormatted.amountDisplay}
        </td>
        <td className="px-4 py-2.5">
          <StatusPill status={latest.status} />
        </td>
        <td className="px-4 py-2.5 text-[12px] text-slate-500">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10.5px] font-medium ${latest.mode === 'live' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
            {latest.mode}
          </span>
        </td>
        <td className="px-4 py-2.5 text-[12px] text-slate-400 max-w-[180px] truncate">
          {latest.failureReason ?? ''}
        </td>
      </tr>
      {expanded && isMulti && attempts.slice(1).map((attempt) => {
        const fmt = formatSpendCardPure({
          amountMinor: attempt.amountMinor,
          currency: attempt.currency,
          merchantId: attempt.merchantId,
          merchantDescriptor: attempt.merchantDescriptor,
        });
        return (
          <tr key={attempt.id} className="border-b border-slate-50 bg-slate-50/60">
            <td className="pl-8 pr-4 py-2 text-[12px] text-slate-500 w-[140px]">
              {new Date(attempt.createdAt).toLocaleString()}
            </td>
            <td className="px-4 py-2 text-[12px] text-slate-600 pl-10">
              {fmt.merchantDisplay}
            </td>
            <td className="px-4 py-2 text-[12px] text-slate-600 text-right font-mono">
              {fmt.amountDisplay}
            </td>
            <td className="px-4 py-2">
              <StatusPill status={attempt.status} />
            </td>
            <td className="px-4 py-2 text-[12px] text-slate-400">
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10.5px] font-medium ${attempt.mode === 'live' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {attempt.mode}
              </span>
            </td>
            <td className="px-4 py-2 text-[12px] text-slate-400 max-w-[180px] truncate">
              {attempt.failureReason ?? ''}
            </td>
          </tr>
        );
      })}
    </>
  );
}
