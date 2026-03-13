/**
 * PortalLandingPage — shown when a user has subaccount assignments.
 * Lets them pick which subaccount portal to enter.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface SubaccountEntry {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export default function PortalLandingPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [subaccounts, setSubaccounts] = useState<SubaccountEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/portal/my-subaccounts')
      .then(({ data }) => {
        setSubaccounts(data);
        // Auto-redirect if user has exactly one subaccount
        if (data.length === 1) {
          navigate(`/portal/${data[0].id}`, { replace: true });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;

  if (subaccounts.length === 0) {
    return (
      <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>No portal access</h2>
        <p style={{ color: '#64748b', fontSize: 14 }}>
          You haven't been assigned to any subaccounts yet. Contact your administrator for access.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '40px auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Select subaccount</h1>
      <p style={{ color: '#64748b', marginBottom: 28 }}>Choose which subaccount you'd like to access.</p>
      <div style={{ display: 'grid', gap: 12 }}>
        {subaccounts.map((sa) => (
          <button
            key={sa.id}
            onClick={() => navigate(`/portal/${sa.id}`)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, color: '#1e293b', marginBottom: 2 }}>{sa.name}</div>
              <div style={{ fontSize: 13, color: '#64748b', fontFamily: 'monospace' }}>{sa.slug}</div>
            </div>
            <span style={{ color: '#94a3b8', fontSize: 20 }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
