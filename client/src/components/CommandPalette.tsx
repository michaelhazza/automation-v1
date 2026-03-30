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
  { label: 'Automations', to: '/processes', keywords: 'processes' },
  { label: 'Activity', to: '/executions', keywords: 'executions history' },
  { label: 'Profile Settings', to: '/settings' },
  { label: 'Clients', to: '/admin/subaccounts', keywords: 'subaccounts' },
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

  const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#22c55e','#0ea5e9','#14b8a6'];
  const avatarColor = (str: string) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  };

  let globalIdx = 0;

  const renderGroup = (label: string, items: Result[]) => {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {label}
        </div>
        {items.map(r => {
          const idx = globalIdx++;
          const isSelected = idx === selected;
          const key = r.kind === 'nav' ? r.item.to : r.item.id;
          return (
            <button
              key={key}
              onMouseEnter={() => setSelected(idx)}
              onClick={() => execute(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 14px', border: 'none', cursor: 'pointer',
                background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                color: isSelected ? '#e2e8f0' : '#94a3b8',
                fontSize: 13, fontWeight: 500, textAlign: 'left', fontFamily: 'inherit',
                transition: 'background 0.05s',
              }}
            >
              {r.kind === 'client' && (
                <span style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: avatarColor(r.item.name),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: 'white',
                }}>
                  {r.item.name.split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase()}
                </span>
              )}
              {r.kind === 'agent' && (
                <span style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                }}>🤖</span>
              )}
              {r.kind === 'nav' && (
                <span style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: 'rgba(255,255,255,0.05)', color: '#64748b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
                }}>→</span>
              )}
              <span style={{ flex: 1 }}>{r.item.name ?? (r as { item: NavEntry }).item.label}</span>
              {r.kind === 'client' && r.item.id === activeClientId && (
                <span style={{ fontSize: 10, color: '#22c55e' }}>active</span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  // Reset globalIdx for render
  globalIdx = 0;
  const navResults = results.filter(r => r.kind === 'nav');
  const clientResults = results.filter(r => r.kind === 'client');
  const agentResults = results.filter(r => r.kind === 'agent');
  // Recount after filtering
  const navStart = 0;
  const clientStart = navResults.length;
  const agentStart = clientStart + clientResults.length;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, background: '#1e293b',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          overflow: 'hidden', animation: 'fadeInScale 0.12s ease-out both',
        }}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, clients, agents..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 15, color: '#f1f5f9', fontFamily: 'inherit',
            }}
          />
          <span style={{ fontSize: 11, color: '#334155', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>
            esc
          </span>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {results.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
              No results for "{query}"
            </div>
          )}
          {/* Render groups with correct index offsets */}
          {navResults.length > 0 && (
            <div>
              <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Navigate</div>
              {navResults.map((r, i) => {
                const idx = navStart + i;
                const isSelected = idx === selected;
                const item = r.item as NavEntry;
                return (
                  <button key={item.to} onMouseEnter={() => setSelected(idx)} onClick={() => execute(r)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px',
                    border: 'none', cursor: 'pointer', background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: isSelected ? '#e2e8f0' : '#94a3b8', fontSize: 13, fontWeight: 500, textAlign: 'left', fontFamily: 'inherit',
                  }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: 'rgba(255,255,255,0.05)', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>→</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {clientResults.length > 0 && (
            <div>
              <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Clients</div>
              {clientResults.map((r, i) => {
                const idx = clientStart + i;
                const isSelected = idx === selected;
                const item = r.item as Client;
                const bg = avatarColor(item.name);
                const inits = item.name.split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
                return (
                  <button key={item.id} onMouseEnter={() => setSelected(idx)} onClick={() => execute(r)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px',
                    border: 'none', cursor: 'pointer', background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: isSelected ? '#e2e8f0' : '#94a3b8', fontSize: 13, fontWeight: 500, textAlign: 'left', fontFamily: 'inherit',
                  }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'white' }}>{inits}</span>
                    <span style={{ flex: 1 }}>{item.name}</span>
                    {item.id === activeClientId && <span style={{ fontSize: 10, color: '#22c55e' }}>active</span>}
                  </button>
                );
              })}
            </div>
          )}
          {agentResults.length > 0 && (
            <div>
              <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>AI Agents</div>
              {agentResults.map((r, i) => {
                const idx = agentStart + i;
                const isSelected = idx === selected;
                const item = r.item as Agent;
                return (
                  <button key={item.id} onMouseEnter={() => setSelected(idx)} onClick={() => execute(r)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px',
                    border: 'none', cursor: 'pointer', background: isSelected ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: isSelected ? '#e2e8f0' : '#94a3b8', fontSize: 13, fontWeight: 500, textAlign: 'left', fontFamily: 'inherit',
                  }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>🤖</span>
                    <span style={{ flex: 1 }}>{item.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 14, fontSize: 11, color: '#334155' }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
