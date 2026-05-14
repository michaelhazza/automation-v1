import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import StartingTeamPicker from '../components/subaccount/StartingTeamPicker';

interface Subaccount {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  active:    'text-green-600',
  suspended: 'text-amber-600',
  inactive:  'text-slate-500',
};

export default function AdminSubaccountsPage({ user: _user }: { user: User }) {
  const [subaccounts, setSubaccounts] = useState<Subaccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '' });
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [applyWarning, setApplyWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = async () => {
    try {
      const { data } = await api.get('/api/subaccounts');
      if (mountedRef.current) setSubaccounts(data);
    } catch {
      if (mountedRef.current) toast.error('Failed to load subaccounts');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    setApplyWarning(null);
    setSubmitting(true);
    try {
      const { data: created } = await api.post('/api/subaccounts', {
        name: form.name,
        slug: form.slug || undefined,
      });
      const createdId: string = created.id;

      if (selectedTemplateId) {
        try {
          await api.post(`/api/hierarchy-templates/${selectedTemplateId}/apply`, {
            subaccountId: createdId,
            mode: 'replace',
          });
          toast.success('Team installed');
        } catch {
          setApplyWarning(
            'Subaccount created, but the starting team could not be installed. You can apply it from the subaccount settings.',
          );
        }
      } else {
        toast.success('Subaccount created');
      }

      setShowForm(false);
      setForm({ name: '', slug: '' });
      setSelectedTemplateId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      const status = e.response?.status;
      const serverMessage = e.response?.data?.error;
      if (status === 403) {
        setError(serverMessage ?? 'You do not have permission to create subaccounts.');
      } else if (status === 409) {
        setError(serverMessage ?? 'A subaccount with this slug already exists.');
      } else {
        setError(serverMessage ?? 'Failed to create subaccount. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/subaccounts/${deleteId}`);
      setDeleteId(null);
      toast.success('Subaccount deleted');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Failed to delete subaccount');
      setDeleteId(null);
    }
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Companies</h1>
          <p className="text-sm text-slate-500 mt-2">Manage companies and their portal access</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(''); }}
          className="btn btn-primary"
        >
          + New company
        </button>
      </div>

      {applyWarning && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
          <span className="text-amber-600 text-[13px] flex-1">{applyWarning}</span>
          <button onClick={() => setApplyWarning(null)} className="text-amber-400 hover:text-amber-600 text-xs font-medium shrink-0">Dismiss</button>
        </div>
      )}

      {showForm && (
        <Modal title="New company" onClose={() => { setShowForm(false); setSelectedTemplateId(null); }} maxWidth={480}>
          {error && <div className="text-[13px] text-red-600 mb-3">{error}</div>}
          <div className="grid gap-4 mb-6">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Slug (optional — auto-derived from name)</label>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="e.g. my-client"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Starting team (optional)</label>
              <StartingTeamPicker
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
                disabled={submitting}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="btn btn-primary"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => { setShowForm(false); setSelectedTemplateId(null); }}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete company"
          message="Are you sure you want to delete this company? Members will lose access."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {subaccounts.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">No companies yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Slug</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {subaccounts.map((sa) => (
                <tr key={sa.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{sa.name}</td>
                  <td className="px-4 py-3 font-mono text-[13px] text-slate-500">{sa.slug}</td>
                  <td className="px-4 py-3">
                    <span className={`font-medium capitalize text-[13px] ${STATUS_STYLES[sa.status] ?? 'text-slate-500'}`}>
                      {sa.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link
                        to={`/admin/subaccounts/${sa.id}`}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium no-underline transition-colors"
                      >
                        Manage
                      </Link>
                      <button
                        onClick={() => setDeleteId(sa.id)}
                        className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
