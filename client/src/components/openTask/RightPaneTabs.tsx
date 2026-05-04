import { useState } from 'react';
import { NowTab } from './NowTab';
import { PlanTab } from './PlanTab';
import { FilesTab } from './FilesTab';
import type { TaskProjection, FileProjection } from '../../../../shared/types/taskProjection';

type Tab = 'now' | 'plan' | 'files';

interface RightPaneTabsProps {
  projection: TaskProjection;
  taskId: string;
  files: FileProjection[];
}

export function RightPaneTabs({ projection, taskId, files }: RightPaneTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('plan');

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-slate-200 px-4">
        {(['now', 'plan', 'files'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2.5 text-[13px] border-b-2 -mb-px transition-colors capitalize ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'now' && <NowTab projection={projection} />}
        {activeTab === 'plan' && <PlanTab projection={projection} />}
        {activeTab === 'files' && <FilesTab taskId={taskId} files={files} />}
      </div>
    </div>
  );
}
