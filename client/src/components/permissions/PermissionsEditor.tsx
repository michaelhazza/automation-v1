import { useState } from 'react';
import Modal from '../Modal';
import { getGroupMeta } from '../org-settings/permissionGroups';

interface Permission { key: string; description: string; groupName: string; }
interface PermissionSet { id: string; name: string; description: string | null; isDefault: boolean; permissionKeys: string[]; }

export function PermissionsEditor({
  set, permsByGroup, onSave, onClose,
}: {
  set: PermissionSet;
  permsByGroup: Record<string, Permission[]>;
  onSave: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(set.permissionKeys));
  const [tooltip, setTooltip] = useState<string | null>(null);

  const toggle = (key: string) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const toggleGroup = (keys: string[]) => {
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k)); else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  return (
    <Modal title={`Edit permissions: ${set.name}`} onClose={onClose} maxWidth={580}>
      <p className="m-0 mb-4 text-[13px] text-slate-500">
        Select which actions members with this role can perform. Toggle a category header to select or deselect all permissions in that group.
      </p>
      <div className="max-h-[420px] overflow-y-auto -mx-1 px-1 mb-5 space-y-2">
        {Object.entries(permsByGroup).map(([group, perms]) => {
          const groupKeys = perms.map((p) => p.key);
          const allGroupSelected = groupKeys.every((k) => selected.has(k));
          const someGroupSelected = groupKeys.some((k) => selected.has(k)) && !allGroupSelected;
          const meta = getGroupMeta(group);
          return (
            <div key={group} className="border border-slate-200 rounded-xl overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                onClick={() => toggleGroup(groupKeys)}
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={allGroupSelected}
                  ref={(el) => { if (el) el.indeterminate = someGroupSelected; }}
                  className="cursor-pointer w-4 h-4 accent-indigo-600"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-semibold text-slate-800">{meta.label}</span>
                  <span className="ml-2 text-[11px] text-slate-400 font-mono">{group}</span>
                </div>
                {meta.description && (
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setTooltip(tooltip === group ? null : group); }}
                      className="w-5 h-5 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-500 text-[11px] font-bold flex items-center justify-center border-0 cursor-pointer transition-colors"
                    >
                      ?
                    </button>
                    {tooltip === group && (
                      <div className="absolute right-0 top-7 z-10 w-64 bg-slate-800 text-white text-[12px] rounded-lg px-3 py-2 shadow-lg leading-snug">
                        {meta.description}
                        <div className="absolute -top-1.5 right-2 w-3 h-3 bg-slate-800 rotate-45" />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="divide-y divide-slate-50">
                {perms.map((p) => (
                  <label
                    key={p.key}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${selected.has(p.key) ? 'bg-indigo-50' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.key)}
                      onChange={() => toggle(p.key)}
                      className="cursor-pointer w-4 h-4 accent-indigo-600 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] text-slate-800">{p.description}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono shrink-0 hidden sm:inline">{p.key}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-slate-400">{selected.size} permission{selected.size !== 1 ? 's' : ''} selected</span>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={() => onSave([...selected])} className="btn btn-primary">
            Save changes
          </button>
        </div>
      </div>
    </Modal>
  );
}
