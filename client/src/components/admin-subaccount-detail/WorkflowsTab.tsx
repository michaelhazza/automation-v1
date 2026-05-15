import { useState } from 'react';
import api from '../../lib/api';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';
import type { ProcessLink, OrgProcess, Category } from './types';

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const btnPrimary = 'btn btn-primary';
const btnSecondary = 'btn btn-secondary';

interface WorkflowsTabProps {
  subaccountId: string;
  linkedProcesses: ProcessLink[];
  orgProcesses: OrgProcess[];
  categories: Category[];
  onChange: () => void;
}

export function WorkflowsTab({ subaccountId, linkedProcesses, orgProcesses, categories, onChange }: WorkflowsTabProps) {
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkForm, setLinkForm] = useState({ processId: '', subaccountCategoryId: '' });
  const [deleteLinkId, setDeleteLinkId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleCreateLink = async () => {
    setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/automations`, {
        processId: linkForm.processId,
        subaccountCategoryId: linkForm.subaccountCategoryId || undefined,
      });
      setShowLinkForm(false); setLinkForm({ processId: '', subaccountCategoryId: '' }); onChange();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to link workflow');
    }
  };

  const handleDeleteLink = async () => {
    if (!deleteLinkId) return;
    await api.delete(`/api/subaccounts/${subaccountId}/automations/${deleteLinkId}`);
    setDeleteLinkId(null); onChange();
  };

  const handleToggleLinkActive = async (link: ProcessLink) => {
    await api.patch(`/api/subaccounts/${subaccountId}/automations/${link.linkId}`, { isActive: !link.isActive });
    onChange();
  };

  return (
    <>
      {error && <div className="text-[13px] text-red-600 mb-4">{error}</div>}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-[18px] font-semibold text-slate-800 m-0">Linked workflows</h2>
        <button onClick={() => setShowLinkForm(true)} className="btn btn-sm btn-primary">
          + Link workflow
        </button>
      </div>

      {showLinkForm && (
        <Modal title="Link workflow to company" onClose={() => setShowLinkForm(false)} maxWidth={400}>
          <div className="grid gap-3.5 mb-5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Org workflow *</label>
              <select value={linkForm.processId} onChange={(e) => setLinkForm({ ...linkForm, processId: e.target.value })} className={inputCls}>
                <option value="">Select workflow...</option>
                {orgProcesses.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Portal category (optional)</label>
              <select value={linkForm.subaccountCategoryId} onChange={(e) => setLinkForm({ ...linkForm, subaccountCategoryId: e.target.value })} className={inputCls}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreateLink} className={btnPrimary}>Link</button>
            <button onClick={() => setShowLinkForm(false)} className={btnSecondary}>Cancel</button>
          </div>
        </Modal>
      )}

      {deleteLinkId && (
        <ConfirmDialog title="Remove workflow link" message="Remove this workflow from the company?" confirmLabel="Remove" onConfirm={handleDeleteLink} onCancel={() => setDeleteLinkId(null)} />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {linkedProcesses.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">No workflows linked yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Workflow</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Active in portal</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {linkedProcesses.map((link) => (
                <tr key={link.linkId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{link.processName}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-500 capitalize">{link.processStatus}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleLinkActive(link)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${link.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      {link.isActive ? 'Active' : 'Hidden'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setDeleteLinkId(link.linkId)} className="btn btn-xs btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
