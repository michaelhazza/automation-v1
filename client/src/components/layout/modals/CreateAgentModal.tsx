import { useState } from 'react';
import api from '../../../lib/api';

const AGENT_ICONS = [
  // People & roles
  '🤖','🧑‍💻','👩‍💼','🕵️','🧑‍🔬','👷','🧑‍🏫','🧑‍⚕️','🦸','🧙',
  // Work & tools
  '🔍','🛠️','📊','📋','🧪','🎯','💡','📝','🔧','⚙️',
  // Communication
  '💬','📢','🔔','📨','🤝','📞','🗂️','📂','📎','🏷️',
  // Status & quality
  '✅','🚀','⚡','🔒','🛡️','🏆','💎','🌟','🎨','🧩',
  // Domain
  '🐛','🔬','📐','🧮','📈','🗃️','🌐','☁️','🔗','🤔',
];

interface CreateAgentModalProps {
  open: boolean;
  activeClientId: string;
  onClose(): void;
  onCreated(agentId: string): void;
}

export function CreateAgentModal({ open, activeClientId, onClose, onCreated }: CreateAgentModalProps) {
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDesc, setNewAgentDesc] = useState('');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');
  const [newAgentIcon, setNewAgentIcon] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [createAgentLoading, setCreateAgentLoading] = useState(false);
  const [createAgentError, setCreateAgentError] = useState('');

  if (!open || !activeClientId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-[17px] font-bold text-slate-900 m-0">Create Agent</h2>
          <button onClick={() => { onClose(); setShowIconPicker(false); }} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!newAgentName.trim() || !newAgentPrompt.trim() || createAgentLoading) return;
          setCreateAgentLoading(true);
          setCreateAgentError('');
          try {
            const { data: agent } = await api.post('/api/agents', {
              name: newAgentName.trim(),
              description: newAgentDesc.trim() || undefined,
              masterPrompt: newAgentPrompt.trim(),
              icon: newAgentIcon.trim() || undefined,
              agentRole: newAgentRole.trim() || undefined,
              status: 'active',
            });
            await api.post(`/api/subaccounts/${activeClientId}/agents`, { agentId: agent.id });
            setShowIconPicker(false);
            setNewAgentName(''); setNewAgentDesc(''); setNewAgentPrompt('');
            setNewAgentIcon(''); setNewAgentRole(''); setCreateAgentError('');
            onCreated(agent.id);
            onClose();
          } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } } };
            setCreateAgentError(e.response?.data?.error ?? 'Failed to create agent');
          } finally { setCreateAgentLoading(false); }
        }} className="p-6 flex flex-col gap-4">
          {createAgentError && <div className="text-[13px] text-red-600">{createAgentError}</div>}

          {/* Icon + Name row */}
          <div className="flex gap-3">
            <div className="shrink-0 relative">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Icon</label>
              <button
                type="button"
                onClick={() => setShowIconPicker(!showIconPicker)}
                className={`w-12 h-10 text-center text-lg border rounded-lg cursor-pointer transition-colors flex items-center justify-center ${
                  showIconPicker ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                {newAgentIcon || <span className="text-slate-300 text-sm">+</span>}
              </button>

              {/* Icon picker popover */}
              {showIconPicker && (
                <div className="absolute top-full left-0 mt-2 z-20 bg-white border border-slate-200 rounded-xl shadow-xl p-3 w-[340px] animate-[fadeIn_0.1s_ease-out_both]">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Choose an icon</div>
                  <div className="grid grid-cols-7 gap-1">
                    {AGENT_ICONS.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => { setNewAgentIcon(icon); setShowIconPicker(false); }}
                        className={`w-10 h-10 rounded-lg text-2xl flex items-center justify-center cursor-pointer border-0 transition-all ${
                          newAgentIcon === icon
                            ? 'bg-indigo-100 ring-2 ring-indigo-500 scale-110'
                            : 'bg-transparent hover:bg-slate-100'
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                  {newAgentIcon && (
                    <button
                      type="button"
                      onClick={() => { setNewAgentIcon(''); setShowIconPicker(false); }}
                      className="mt-2 w-full text-[11px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer"
                    >
                      Clear icon
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
              <input
                autoFocus
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="e.g. QA Engineer"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description <span className="text-slate-400 font-normal">(optional)</span></label>
            <input
              value={newAgentDesc}
              onChange={(e) => setNewAgentDesc(e.target.value)}
              placeholder="What does this agent do?"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Role <span className="text-slate-400 font-normal">(optional — displayed in org chart)</span></label>
            <input
              value={newAgentRole}
              onChange={(e) => setNewAgentRole(e.target.value)}
              placeholder="e.g. Business Analyst, QA Lead, Senior Developer"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">System prompt *</label>
            <textarea
              value={newAgentPrompt}
              onChange={(e) => setNewAgentPrompt(e.target.value)}
              placeholder="You are a QA engineer. Your job is to..."
              rows={5}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={() => { onClose(); setShowIconPicker(false); }} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={!newAgentName.trim() || !newAgentPrompt.trim() || createAgentLoading} className="btn btn-primary">{createAgentLoading ? 'Creating...' : 'Create Agent'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
