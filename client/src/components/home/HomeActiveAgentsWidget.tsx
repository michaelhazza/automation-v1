/**
 * Live Home widget: shows active agents grouped into presence sections.
 * Replaces the static Active Agents MetricCard on the Home page.
 *
 * Agent Workspace Chunk 9.
 */

import { useEffect, useRef } from 'react';
import { useWorkspacePresence } from '../../hooks/useWorkspacePresence';
import { orderHomePresenceSections, getEffectiveSection } from '../../lib/orderHomePresenceSections';
import type { PresenceSection, PresenceRow } from '../../lib/orderHomePresenceSections';
import { announceLiveUpdate } from '../../lib/accessibility/announceLiveUpdate';

interface HomeActiveAgentsWidgetProps {
  subaccountId: string;
}

const SECTION_LABELS: Record<PresenceSection, string> = {
  waiting_on_you: 'Waiting on you',
  working_now: 'Working now',
  failing: 'Failing',
  scheduled_next: 'Scheduled next',
  idle: 'Idle',
};

function AgentRow({ row }: { row: PresenceRow }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-slate-700">
      <span className="font-mono text-xs text-slate-400 truncate max-w-[180px]" title={row.agentId}>
        {row.agentId}
      </span>
    </div>
  );
}

export function HomeActiveAgentsWidget({ subaccountId }: HomeActiveAgentsWidgetProps) {
  const { rows, isConnected, isReconnecting } = useWorkspacePresence(subaccountId);
  const sortedRows = orderHomePresenceSections(rows);
  const prevRowCountRef = useRef<number>(0);

  // Announce when rows change
  useEffect(() => {
    if (rows.length !== prevRowCountRef.current) {
      announceLiveUpdate(
        `home-active-agents-${subaccountId}`,
        `Active agents updated: ${rows.length} agent${rows.length === 1 ? '' : 's'}`,
      );
      prevRowCountRef.current = rows.length;
    }
  }, [rows, subaccountId]);

  // Group sorted rows into sections
  const sections: Partial<Record<PresenceSection, PresenceRow[]>> = {};
  for (const row of sortedRows) {
    const section = getEffectiveSection(row);
    if (!sections[section]) sections[section] = [];
    sections[section]!.push(row);
  }

  const sectionOrder: PresenceSection[] = [
    'waiting_on_you',
    'working_now',
    'failing',
    'scheduled_next',
    'idle',
  ];

  return (
    <div
      aria-live="polite"
      className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
          Active Agents
        </div>
        <div className="flex items-center gap-1.5">
          {isReconnecting && (
            <span className="text-xs text-amber-500 font-medium">Reconnecting...</span>
          )}
          {isConnected && !isReconnecting && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" title="Live" />
          )}
        </div>
      </div>

      {/* States */}
      {!isConnected && !isReconnecting && (
        <div className="text-sm text-slate-400 py-2 text-center">Loading...</div>
      )}

      {isConnected && rows.length === 0 && !isReconnecting && (
        <div className="text-sm text-slate-400 py-2 text-center">No agents yet.</div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {sectionOrder.map((section) => {
            const sectionRows = sections[section];
            if (!sectionRows || sectionRows.length === 0) return null;
            return (
              <div key={section}>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  {SECTION_LABELS[section]}
                </div>
                {sectionRows.map((row) => (
                  <AgentRow key={row.agentId} row={row} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
