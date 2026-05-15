import { useEffect, useState } from 'react';
import api from '../../../lib/api';
import type { ClientOption } from '../../../hooks/useLayoutIdentity';

interface CreateClientModalProps {
  open: boolean;
  onClose(): void;
  onCreated(client: ClientOption): void;
}

export function CreateClientModal({ open, onClose, onCreated }: CreateClientModalProps) {
  const [newClientName, setNewClientName] = useState('');
  const [newClientSlug, setNewClientSlug] = useState('');
  const [createClientError, setCreateClientError] = useState('');
  const [createClientLoading, setCreateClientLoading] = useState(false);

  // Pre-split Layout.tsx reset these on every open. The extracted modal stays
  // mounted across close/reopen, so without an open-effect reset stale values
  // (failed-create errors, half-filled fields) reappear next time.
  useEffect(() => {
    if (open) {
      setNewClientName('');
      setNewClientSlug('');
      setCreateClientError('');
      setCreateClientLoading(false);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-[17px] font-bold text-slate-900 m-0">New Company</h2>
          <button onClick={onClose} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!newClientName.trim() || createClientLoading) return;
          setCreateClientLoading(true);
          setCreateClientError('');
          try {
            const { data } = await api.post('/api/subaccounts', {
              name: newClientName.trim(),
              slug: newClientSlug.trim() || undefined,
              status: 'active',
            });
            onClose();
            // Optimistically add the new company so the icon appears right away.
            // Layout wires onCreated -> identity.addSubaccount + identity.selectClient.
            const newEntry: ClientOption = { id: data.id, name: data.name, slug: data.slug ?? '', status: data.status ?? 'active' };
            onCreated(newEntry);
          } catch (err: unknown) {
            const e = err as { response?: { status?: number; data?: { error?: string } } };
            const msg = e.response?.data?.error;
            if (e.response?.status === 403) setCreateClientError(msg ?? 'You do not have permission to create companies.');
            else if (e.response?.status === 409) setCreateClientError(msg ?? 'A company with this slug already exists.');
            else setCreateClientError(msg ?? 'Failed to create company.');
          } finally { setCreateClientLoading(false); }
        }} className="p-6 flex flex-col gap-4">
          {createClientError && <div className="text-[13px] text-red-600">{createClientError}</div>}
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Company name *</label>
            <input autoFocus type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="e.g. Acme Corp" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Slug <span className="text-slate-400 font-normal">(optional, auto-generated)</span></label>
            <input type="text" value={newClientSlug} onChange={(e) => setNewClientSlug(e.target.value)} placeholder="acme-corp" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={!newClientName.trim() || createClientLoading} className="btn btn-primary">{createClientLoading ? 'Creating...' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
