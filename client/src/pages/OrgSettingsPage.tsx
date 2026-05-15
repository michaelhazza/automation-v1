import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, getActiveOrgId, getActiveOrgName } from '../lib/auth';
import AdminBoardConfigPage from './AdminBoardConfigPage';
import AdminCategoriesPage from './AdminCategoriesPage';
import AdminEnginesPage from './AdminEnginesPage';
import OrgMemoryPage from './OrgMemoryPage';
import GeneralTab from '../components/org-settings/GeneralTab';
import PermissionsTab from '../components/org-settings/PermissionsTab';

type ActiveTab = 'board' | 'categories' | 'engines' | 'memory' | 'general' | 'permissions';

const TAB_LABELS: Record<ActiveTab, string> = {
  board: 'Board Config',
  categories: 'Categories',
  engines: 'Engines',
  memory: 'Org Memory',
  general: 'General',
  permissions: 'Permissions',
};

export default function OrgSettingsPage({ user }: { user: User }) {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: ActiveTab = tabParam && ['board', 'categories', 'engines', 'memory', 'general', 'permissions'].includes(tabParam)
    ? tabParam as ActiveTab : 'board';
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);

  const orgId = getActiveOrgId();
  const orgName = getActiveOrgName();
  const isSystemAdmin = user.role === 'system_admin';

  // Non-system-admins see: board, categories, engines
  // System admins additionally see: general, permissions
  const visibleTabs: ActiveTab[] = isSystemAdmin
    ? ['board', 'categories', 'engines', 'memory', 'general', 'permissions']
    : ['board', 'categories', 'engines', 'memory'];

  if (!orgId) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both] p-10">
        <h1 className="text-[28px] font-extrabold text-slate-900 mb-2">Manage Organisation</h1>
        <p className="text-[14px] text-slate-500">Select an organisation from the sidebar to view settings.</p>
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-6">
        <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0 mb-1.5">Manage Organisation</h1>
        <p className="text-[14px] text-slate-500 m-0">Manage settings for {orgName ?? 'your organisation'}</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-[14px] border-b-2 -mb-px transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-700 font-normal'}`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'board' && <AdminBoardConfigPage user={user} embedded />}
      {activeTab === 'categories' && <AdminCategoriesPage user={user} embedded />}
      {activeTab === 'engines' && <AdminEnginesPage user={user} embedded />}
      {activeTab === 'memory' && <OrgMemoryPage embedded />}
      {activeTab === 'general' && <GeneralTab orgId={orgId} orgName={orgName} />}
      {activeTab === 'permissions' && <PermissionsTab />}
    </div>
  );
}
