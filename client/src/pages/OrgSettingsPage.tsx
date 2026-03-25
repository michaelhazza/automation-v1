import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User, getActiveOrgId, getActiveOrgName } from '../lib/auth';

interface OrgData {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  settings: Record<string, unknown> | null;
  createdAt: string;
}

export default function OrgSettingsPage({ user }: { user: User }) {
  const [org, setOrg] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  const orgId = getActiveOrgId();
  const orgName = getActiveOrgName();

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    api.get(`/api/organisations/${orgId}`)
      .then(({ data }) => {
        setOrg(data);
        setEditName(data.name);
        setEditSlug(data.slug);
        setEditPlan(data.plan);
        setEditStatus(data.status);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleSave = async () => {
    if (!orgId) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const { data } = await api.patch(`/api/organisations/${orgId}`, {
        name: editName,
        slug: editSlug,
        plan: editPlan,
        status: editStatus,
      });
      setOrg(data);
      setSaveMsg('Settings saved.');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch {
      setSaveMsg('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  if (!orgId) {
    return (
      <div className="page-enter" style={{ padding: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Organisation Settings</h1>
        <p style={{ color: '#64748b' }}>Select an organisation from the sidebar to view settings.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-enter" style={{ padding: 40 }}>
        <div className="skeleton" style={{ height: 32, width: 280, borderRadius: 8, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="page-enter" style={{ padding: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Organisation Settings</h1>
        <p style={{ color: '#64748b' }}>Organisation not found.</p>
      </div>
    );
  }

  const hasChanges = editName !== org.name || editSlug !== org.slug || editPlan !== org.plan || editStatus !== org.status;

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
          Organisation Settings
        </h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
          Manage settings for {orgName ?? org.name}
        </p>
      </div>

      <div className="card" style={{ padding: 24, maxWidth: 600 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 }}>
              Organisation Name
            </label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="form-input"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 }}>
              Slug
            </label>
            <input
              value={editSlug}
              onChange={(e) => setEditSlug(e.target.value)}
              className="form-input"
            />
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 }}>
                Plan
              </label>
              <select value={editPlan} onChange={(e) => setEditPlan(e.target.value)} className="form-select" style={{ width: '100%' }}>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="agency">Agency</option>
              </select>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 }}>
                Status
              </label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="form-select" style={{ width: '100%' }}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Created {new Date(org.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="btn btn-primary"
              style={{ fontSize: 14 }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saveMsg && (
              <span style={{ fontSize: 13, color: saveMsg.includes('Failed') ? '#ef4444' : '#10b981', fontWeight: 500 }}>
                {saveMsg}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
