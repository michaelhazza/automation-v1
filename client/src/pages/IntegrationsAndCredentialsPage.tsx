import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import CredentialsTab from '../components/CredentialsTab';
import McpServersPage from './McpServersPage';

type Tab = 'credentials' | 'integrations';

interface User { id: string; role: string; organisationId?: string }

interface Props {
  user: User;
  subaccountId?: string;
  embedded?: boolean;
}

export default function IntegrationsAndCredentialsPage({ user, subaccountId, embedded = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get('tab');
    return t === 'integrations' ? 'integrations' : 'credentials';
  });

  // Keep URL in sync with active tab
  useEffect(() => {
    setSearchParams(p => { p.set('tab', activeTab); return p; }, { replace: true });
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { id: Tab; label: string }[] = [
    { id: 'credentials', label: 'Credentials' },
    { id: 'integrations', label: 'Integrations' },
  ];

  return (
    <div className={embedded ? '' : 'p-6'}>
      {!embedded && (
        <h1 className="text-xl font-semibold text-slate-800 mb-6">Integrations &amp; Credentials</h1>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'credentials' && (
        <CredentialsTab subaccountId={subaccountId} />
      )}

      {activeTab === 'integrations' && (
        <McpServersPage user={user} subaccountId={subaccountId} embedded={true} />
      )}
    </div>
  );
}
