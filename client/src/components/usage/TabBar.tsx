import type { Tab } from './types';

interface TabBarProps {
  active: Tab;
  onChange(next: Tab): void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'agents',   label: 'Agents' },
    { id: 'models',   label: 'Models' },
    { id: 'runs',     label: 'Runs' },
    { id: 'routing',  label: 'Routing' },
    { id: 'iee',            label: 'IEE Execution' },
    { id: 'memory_utility', label: 'Memory Utility' },
  ];
  return (
    <div className="flex gap-0.5 border-b border-slate-200 mb-6">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-[13px] font-semibold border-0 bg-transparent cursor-pointer transition-colors border-b-2 -mb-px [font-family:inherit] ${
            active === t.id
              ? 'text-indigo-600 border-indigo-500'
              : 'text-slate-500 border-transparent hover:text-slate-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
