import { useState, useEffect, useRef } from 'react';
import type { BriefCreationEnvelope } from '../../../../../shared/types/briefFastPath.js';
import api from '../../../lib/api';
import type { LayoutIdentity, OrgOption, ClientOption } from '../../../hooks/useLayoutIdentity';

interface NewBriefModalProps {
  open: boolean;
  onClose(): void;
  identity: LayoutIdentity;
  orgs: OrgOption[];
  subaccounts: ClientOption[];
  onSubmitted(briefId: string, contextSwitch: { org?: OrgOption; subaccount?: ClientOption }): void;
}

export function NewBriefModal({ open, onClose, identity, orgs, subaccounts, onSubmitted }: NewBriefModalProps) {
  const [newBriefTitle, setNewBriefTitle] = useState('');
  const [newBriefDesc, setNewBriefDesc] = useState('');
  const [newBriefPriority, setNewBriefPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [newBriefLoading, setNewBriefLoading] = useState(false);
  const [briefOrgOverride, setBriefOrgOverride] = useState<OrgOption | null>(null);
  const [briefSubaccountOverride, setBriefSubaccountOverride] = useState<ClientOption | null>(null);

  // Seed override state on the closed -> open transition; while the modal is
  // open, sync the override to current activeOrg/activeClient ONLY if the user
  // hasn't manually picked a different value. Tracking what we last seeded
  // (`prevSeededRef`) lets us distinguish "untouched seed" from "manual pick".
  // Covers three cases:
  //   1. In-flight data race — first seed was null because orgs/subaccounts
  //      hadn't loaded yet; patch when they arrive (current === null branch).
  //   2. Identity changes while modal is open — active org/client moved to a
  //      new value; if the override still equals the previously-seeded ID,
  //      treat it as untouched and re-sync (current.id === prev.id branch).
  //   3. User manually overrode — current.id no longer equals the last seed;
  //      leave it alone.
  const wasOpenRef = useRef(false);
  const prevSeededRef = useRef<{ orgId: string | null; clientId: string | null } | null>(null);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      prevSeededRef.current = null;
      return;
    }
    const opening = !wasOpenRef.current;
    wasOpenRef.current = true;
    const nextOrg = orgs.find((o) => o.id === identity.activeOrgId) ?? null;
    const nextSub = subaccounts.find((s) => s.id === identity.activeClientId) ?? null;
    const prev = prevSeededRef.current;
    prevSeededRef.current = { orgId: identity.activeOrgId, clientId: identity.activeClientId };

    setBriefOrgOverride((current) => {
      if (opening) return nextOrg;
      if (current === null) return nextOrg;
      if (current.id === prev?.orgId) return nextOrg;
      return current;
    });
    setBriefSubaccountOverride((current) => {
      if (opening) return nextSub;
      if (current === null) return nextSub;
      if (current.id === prev?.clientId) return nextSub;
      return current;
    });
  }, [open, orgs, subaccounts, identity.activeOrgId, identity.activeClientId]);

  if (!open || !identity.activeClientId) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newBriefTitle.trim() || newBriefLoading) return;

    setNewBriefLoading(true);
    try {
      const targetOrgId = briefOrgOverride?.id ?? identity.activeOrgId;
      // When the user picks a different org without picking a subaccount, do
      // NOT fall back to the current activeClientId — that subaccount belongs
      // to the previous org and would create a cross-tenant tasks row.
      const orgChanged = !!briefOrgOverride && briefOrgOverride.id !== identity.activeOrgId;
      const targetSubaccountId =
        briefSubaccountOverride?.id ?? (orgChanged ? undefined : identity.activeClientId ?? undefined);

      const description = newBriefDesc.trim();
      const res = await api.post<BriefCreationEnvelope>(
        '/api/briefs',
        {
          text: [newBriefTitle.trim(), description].filter(Boolean).join('\n\n'),
          explicitTitle: newBriefTitle.trim(),
          explicitDescription: description || undefined,
          priority: newBriefPriority,
          source: 'new_brief_modal',
          subaccountId: targetSubaccountId,
          uiContext: { surface: 'new_brief_modal', currentSubaccountId: targetSubaccountId },
        },
        targetOrgId && targetOrgId !== identity.activeOrgId
          ? { headers: { 'X-Organisation-Id': targetOrgId } }
          : undefined,
      );

      setNewBriefTitle('');
      setNewBriefDesc('');
      setNewBriefPriority('normal');
      onClose();
      onSubmitted(res.data.briefId, {
        org: briefOrgOverride && briefOrgOverride.id !== identity.activeOrgId ? briefOrgOverride : undefined,
        subaccount: briefSubaccountOverride && briefSubaccountOverride.id !== identity.activeClientId ? briefSubaccountOverride : undefined,
      });
    } catch (err) {
      console.error('[Layout] Failed to create brief:', err);
    } finally {
      setNewBriefLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-[17px] font-bold text-slate-900 m-0">New Task</h2>
          <button onClick={onClose} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Title</label>
            <input autoFocus type="text" value={newBriefTitle} onChange={(e) => setNewBriefTitle(e.target.value)} placeholder="What needs to be done?" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description <span className="text-slate-400 font-normal">(optional)</span></label>
            <textarea value={newBriefDesc} onChange={(e) => setNewBriefDesc(e.target.value)} placeholder="Add more context..." rows={3} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Priority</label>
            <select value={newBriefPriority} onChange={(e) => setNewBriefPriority(e.target.value as typeof newBriefPriority)} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          {/* Org override — system admins only, when multiple orgs exist */}
          {identity.isSystemAdmin && orgs.length > 1 && (
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                Organisation <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <select
                value={briefOrgOverride?.id ?? ''}
                onChange={(e) => {
                  const next = orgs.find((o) => o.id === e.target.value) ?? null;
                  setBriefOrgOverride(next);
                  setBriefSubaccountOverride(null);
                }}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Use current organisation</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Subaccount override — hidden when the user picks a different org,
              because the `subaccounts` list still belongs to the previously
              active org. Allowing a selection here would re-introduce the
              cross-tenant write defended against on submit (see comment at
              line 537). The user can pick the subaccount on the brief page
              after the context switch. */}
          {subaccounts.length > 0 && !(briefOrgOverride && briefOrgOverride.id !== identity.activeOrgId) && (
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                Subaccount <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <select
                value={briefSubaccountOverride?.id ?? ''}
                onChange={(e) => {
                  const next = subaccounts.find((s) => s.id === e.target.value) ?? null;
                  setBriefSubaccountOverride(next);
                }}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Use current subaccount</option>
                {subaccounts.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={!newBriefTitle.trim() || newBriefLoading} className="btn btn-primary">{newBriefLoading ? 'Creating...' : 'Create Task'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
