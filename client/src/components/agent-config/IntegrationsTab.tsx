import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';

interface Connection {
  id: string;
  providerType: string;
  authType: string;
  label: string | null;
  displayName: string | null;
  connectionStatus: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  slack: 'Slack',
  gmail: 'Gmail',
  github: 'GitHub',
  hubspot: 'HubSpot',
  ghl: 'GoHighLevel',
  teamwork: 'Teamwork',
  web_login: 'Web Login',
  custom: 'Custom',
  google_drive: 'Google Drive',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  expired: 'bg-yellow-100 text-yellow-800',
  revoked: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
};

export interface IntegrationsTabProps {
  subaccountId: string;
}

export default function IntegrationsTab({ subaccountId }: IntegrationsTabProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/subaccounts/${subaccountId}/connections`)
      .then(r => {
        const visible = (r.data as Connection[]).filter(c => c.connectionStatus !== 'revoked');
        setConnections(visible);
      })
      .catch(() => setError('Failed to load connections'))
      .finally(() => setLoading(false));
  }, [subaccountId]);

  if (loading) {
    return <div className="text-[13px] text-slate-400">Loading connections…</div>;
  }

  return (
    <div>
      <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="m-0 text-[15px] font-semibold text-slate-900">Credentials this agent can use</h2>
        </div>
        <div className="p-5">
          {error && (
            <div className="mb-4 text-[13px] text-red-600">{error}</div>
          )}

          {connections.length === 0 ? (
            <p className="text-[13px] text-slate-500">
              No connections configured for this subaccount.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {connections.map(conn => (
                <div key={conn.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className="text-[13px] font-medium text-slate-800">
                      {conn.displayName ?? PROVIDER_LABELS[conn.providerType] ?? conn.providerType}
                    </span>
                    {conn.label && (
                      <span className="ml-2 text-[11px] text-slate-400">{conn.label}</span>
                    )}
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[conn.connectionStatus] ?? 'bg-slate-100 text-slate-600'}`}>
                    {conn.connectionStatus}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-[12px] text-slate-400">
              Connections are managed at the subaccount level.{' '}
              <Link
                to={`/admin/subaccounts/${subaccountId}?tab=credentials`}
                className="text-indigo-500 hover:underline no-underline"
              >
                Manage subaccount credentials
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
