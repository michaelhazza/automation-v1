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

  const tabStyle = (tab: SettingsTab): React.CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: `2px solid ${activeTab === tab ? '#2563eb' : 'transparent'}`,
    background: 'transparent',
    color: activeTab === tab ? '#2563eb' : '#64748b',
    fontWeight: activeTab === tab ? 600 : 400,
    fontSize: 14,
    cursor: 'pointer',
  });

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
          Settings
        </h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
          Manage organisation configuration
        </p>
      </div>

      <div style={{ borderBottom: '1px solid #e2e8f0', marginBottom: 24, display: 'flex', gap: 4 }}>
        {(Object.keys(TAB_LABELS) as SettingsTab[]).map(tab => (
          <button key={tab} style={tabStyle(tab)} onClick={() => setActiveTab(tab)}>
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
