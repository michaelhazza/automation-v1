import { useState } from 'react';
import { User } from '../lib/auth';
import AdminBoardConfigPage from './AdminBoardConfigPage';
import AdminCategoriesPage from './AdminCategoriesPage';
import AdminEnginesPage from './AdminEnginesPage';

type SettingsTab = 'board' | 'categories' | 'engines';

const TAB_LABELS: Record<SettingsTab, string> = {
  board: 'Board Config',
  categories: 'Categories',
  engines: 'Engines',
};

export default function AdminSettingsPage({ user, initialTab }: { user: User; initialTab?: SettingsTab }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'board');

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-6">
        <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0">Settings</h1>
        <p className="text-sm text-slate-500 mt-1.5">Manage organisation configuration</p>
      </div>

      <div className="border-b border-slate-200 mb-6 flex gap-1">
        {(Object.keys(TAB_LABELS) as SettingsTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-[14px] font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'board' && <AdminBoardConfigPage user={user} embedded />}
      {activeTab === 'categories' && <AdminCategoriesPage user={user} embedded />}
      {activeTab === 'engines' && <AdminEnginesPage user={user} embedded />}
    </div>
  );
}
