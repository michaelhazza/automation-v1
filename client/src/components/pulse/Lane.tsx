import { useState } from 'react';
import type { PulseItem, PulseLane } from '../../hooks/usePulseAttention';
import { Card } from './Card';

const LANE_LABELS: Record<PulseLane, string> = {
  client: 'Client-facing',
  major: 'Major',
  internal: 'Internal',
};

const LANE_COLORS: Record<PulseLane, string> = {
  client: 'border-blue-400 bg-blue-50',
  major: 'border-amber-400 bg-amber-50',
  internal: 'border-slate-300 bg-slate-50',
};

interface LaneProps {
  laneId: PulseLane;
  items: PulseItem[];
  onApprove: (item: PulseItem) => void;
  onReject: (item: PulseItem) => void;
}

export function Lane({ laneId, items, onApprove, onReject }: LaneProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`rounded-lg border-l-4 ${LANE_COLORS[laneId]} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <span className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}>▸</span>
          {LANE_LABELS[laneId]}
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 shadow-sm">
            {items.length}
          </span>
        </button>
      </div>
      {!collapsed && (
        <div className="space-y-2">
          {items.length === 0 && (
            <p className="text-xs text-slate-400 italic">No items</p>
          )}
          {items.map(item => (
            <Card
              key={item.id}
              item={item}
              laneId={laneId}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
