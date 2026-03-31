import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { setActiveClient } from '../lib/auth';

interface Client { id: string; name: string; status: string; }
interface Agent { id: string; name: string; description?: string; }

interface NavEntry { label: string; to: string; keywords?: string; }

const NAV_ITEMS: NavEntry[] = [
  { label: 'Dashboard', to: '/', keywords: 'home' },
  { label: 'Projects', to: '/projects' },
  { label: 'Workflows', to: '/processes', keywords: 'processes automations' },
  { label: 'Activity', to: '/executions', keywords: 'executions history' },
  { label: 'Profile Settings', to: '/settings' },
  { label: 'Companies', to: '/admin/subaccounts', keywords: 'subaccounts clients' },
  { label: 'Team', to: '/admin/users', keywords: 'users' },
  { label: 'AI Team', to: '/admin/agents', keywords: 'agents' },
  { label: 'Organisations', to: '/system/organisations' },
  { label: 'System Activity', to: '/system/activity' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  activeClientId: string | null;
  onSelectClient: (id: string, name: string) => void;
}

const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#22c55e','#0ea5e9','#14b8a6'];
const avatarColor = (str: string) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};

export default function CommandPalette({ isOpen, onClose, activeClientId, onSelectClient }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch data on open
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelected(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    api.get('/api/subaccounts').then(({ data }) => setClients(data)).catch(() => {});
    api.get('/api/agents').then(({ data }) => setAgents(data)).catch(() => {});
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const q = query.toLowerCase().trim();

  const filteredNav = NAV_ITEMS.filter(n =>
    !q || n.label.toLowerCase().includes(q) || (n.keywords ?? '').includes(q)
  );
  const filteredClients = clients.filter(c => !q || c.name.toLowerCase().includes(q));
  const filteredAgents = agents.filter(a => !q || a.name.toLowerCase().includes(q));

  type Result =
    | { kind: 'nav'; item: NavEntry }
    | { kind: 'client'; item: Client }
    | { kind: 'agent'; item: Agent };

  const results: Result[] = [
    ...filteredNav.map(item => ({ kind: 'nav' as const, item })),
    ...filteredClients.map(item => ({ kind: 'client' as const, item })),
    ...filteredAgents.map(item => ({ kind: 'agent' as const, item })),
  ];

  const execute = useCallback((r: Result) => {
    if (r.kind === 'nav') {
      navigate(r.item.to);
    } else if (r.kind === 'client') {
      setActiveClient(r.item.id, r.item.name);
      onSelectClient(r.item.id, r.item.name);
    } else if (r.kind === 'agent') {
      navigate(`/agents/${r.item.id}`);
    }
    onClose();
  }, [navigate, onClose, onSelectClient]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[selected]) execute(results[selected]);
  };

  if (!isOpen) return null;

  const navResults = results.filter(r => r.kind === 'nav');
  const clientResults = results.filter(r => r.kind === 'client');
  const agentResults = results.filter(r => r.kind === 'agent');
  const navStart = 0;
  const clientStart = navResults.length;
  const agentStart = clientStart + clientResults.length;

  const btnClass = (isSelected: boolean) =>
    `flex items-center gap-2.5 w-full px-3.5 py-2 border-0 cursor-pointer text-[13px] font-medium text-left font-[inherit] transition-[background] duration-[50ms] ${
      isSelected ? 'bg-indigo-500/[0.12] text-slate-200' : 'bg-transparent text-slate-400'
    }`;

  const groupHeaderClass = 'px-3.5 pt-2 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[560px] bg-slate-800 border border-white/10 rounded-[14px] shadow-[0_24px_64px_rgba(0,0,0,0.7)] overflow-hidden animate-[fadeInScale_0.12s_ease-out_both]"
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.07]">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, companies, agents..."
            className="flex-1 bg-transparent border-0 outline-none text-[15px] text-slate-100 font-[inherit]"
          />
          <span className="text-[11px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded">esc</span>
        </div>

        {/* Results */}
        <div className="max-h-[380px] overflow-y-auto">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-slate-500 text-[13px]">
              No results for "{query}"
            </div>
          )}
          {navResults.length > 0 && (
            <div>
              <div className={groupHeaderClass}>Navigate</div>
              {navResults.map((r, i) => {
                const idx = navStart + i;
                const item = r.item as NavEntry;
                return (
                  <button key={item.to} onMouseEnter={() => setSelected(idx)} onClick={() => execute(r)} className={btnClass(idx === selected)}>
                    <span className="w-6 h-6 rounded-md shrink-0 bg-white/5 text-slate-500 flex items-center justify-center text-[11px]">→</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {clientResults.length > 0 && (
            <div>
              <div className={groupHeaderClass}>Companies</div>
              {clientResults.map((r, i) => {
                const idx = clientStart + i;
                const item = r.item as Client;
                const bg = avatarColor(item.name);
                const inits = item.name.split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
                return (
                  <button key={item.id} onMouseEnter={() => setSelected(idx)} onClick={() => execute(r)} className={btnClass(idx === selected)}>
                    <span className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ background: bg }}>{inits}</span>
                    <span className="flex-1">{item.name}</span>
                    {item.id === activeClientId && <span className="text-[10px] text-green-500">active</span>}
                  </button>
                );
              })}
            </div>
          )}
          {agentResults.length > 0 && (
            <div>
              <div className={groupHeaderClass}>AI Agents</div>
              {agentResults.map((r, i) => {
                const idx = agentStart + i;
                const item = r.item as Agent;
                return (
                  <button key={item.id} onMouseEnter={() => setSelected(idx)} onClick={() => execute(r)} className={btnClass(idx === selected)}>
                    <span className="w-6 h-6 rounded-md shrink-0 bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs">🤖</span>
                    <span className="flex-1">{item.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3.5 py-2 border-t border-white/[0.06] flex gap-3.5 text-[11px] text-slate-700">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
