/**
 * RightPaneTabs �� tab switcher for the right pane (Now / Plan / Files).
 *
 * Default tab: Plan (spec-time decision #7).
 * Spec: docs/workflows-dev-spec.md §9.4.
 */

import { useState } from 'react';
import type { TaskProjection } from '../../hooks/useTaskProjectionPure.js';
import NowTab from './NowTab.js';
import PlanTab from './PlanTab.js';
import FilesTab from './FilesTab.js';

type Tab = 'now' | 'plan' | 'files';

interface RightPaneTabsProps {
  projection: TaskProjection;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'now',   label: 'Now' },
  { id: 'plan',  label: 'Plan' },
  { id: 'files', label: 'Files' },
];

export default function RightPaneTabs({ projection }: RightPaneTabsProps) {
  // Default: Plan (decision #7)
  const [activeTab, setActiveTab] = useState<Tab>('plan');

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Tab bar */}
      <div className="flex border-b border-slate-700/50 px-1 pt-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-500 text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === 'now' && (
          <NowTab agentTree={projection.agentTree} />
        )}
        {activeTab === 'plan' && (
          <PlanTab
            planSteps={projection.planSteps}
            taskStatus={projection.status}
          />
        )}
        {activeTab === 'files' && (
          <FilesTab />
        )}
      </div>
    </div>
  );
}
