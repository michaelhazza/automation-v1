import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icons } from './icons';
import { avatarColor, toInitials } from './breadcrumbs';
import type { User } from '../../lib/auth';
import type { LayoutIdentity, OrgOption, ClientOption } from '../../hooks/useLayoutIdentity';

interface IconRailProps {
  user: User;
  identity: LayoutIdentity;
  orgs: OrgOption[];
  subaccounts: ClientOption[];
  canCreateClient: boolean;
  onCreateClient(): void;
}

export function IconRail({ user, identity, orgs, subaccounts, canCreateClient, onCreateClient }: IconRailProps) {
  const navigate = useNavigate();
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const orgPickerRef = useRef<HTMLDivElement>(null);

  // Close org picker on outside click — local UI state per spec §6
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (orgPickerRef.current && !orgPickerRef.current.contains(e.target as Node)) setOrgPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const userInitials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?';

  return (
    <aside className="w-14 bg-[#080e1a] flex flex-col items-center pt-2.5 pb-2.5 border-r border-white/5 shrink-0 gap-1">
      {/* App logo */}
      <Link to="/" className="no-underline mb-1.5">
        <div className="w-9 h-9 rounded-[10px] cursor-pointer bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-[0_2px_8px_rgba(99,102,241,0.4)]">
          <Icons.bolt />
        </div>
      </Link>

      {/* Org picker — system admin only */}
      {identity.isSystemAdmin && (
        <div ref={orgPickerRef} className="relative w-full flex justify-center">
          <button
            onClick={() => setOrgPickerOpen(o => !o)}
            title={identity.activeOrgName ?? 'Select organisation'}
            className={`w-9 h-9 rounded-lg border-none cursor-pointer flex items-center justify-center transition-colors duration-150 [font-family:inherit] ${
              identity.activeOrgId
                ? 'bg-indigo-500/25 text-indigo-300'
                : 'bg-white/[0.06] text-slate-600'
            }`}
          >
            <Icons.platform />
          </button>
          {orgPickerOpen && (
            <div className="absolute left-11 top-0 z-[300] bg-slate-800 border border-white/10 rounded-[10px] shadow-[0_16px_48px_rgba(0,0,0,0.6)] w-[220px] max-h-[280px] overflow-y-auto">
              <div className="px-3 pt-2 pb-[5px] text-[10px] font-bold text-slate-600 uppercase tracking-[0.1em]">
                Organisation
              </div>
              {orgs.length === 0 && (
                <div className="px-[14px] py-[10px] text-slate-600 text-xs">No organisations</div>
              )}
              {orgs.map(org => (
                <button
                  key={org.id}
                  onClick={() => { identity.selectOrg(org); setOrgPickerOpen(false); }}
                  className={`block w-full text-left px-[14px] py-[9px] border-0 border-b border-white/5 text-[13px] cursor-pointer [font-family:inherit] transition-colors ${
                    org.id === identity.activeOrgId
                      ? 'bg-indigo-500/[0.15] text-indigo-300'
                      : 'bg-transparent text-slate-300'
                  }`}
                >
                  {org.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Divider above client icons */}
      {identity.hasOrgContext && subaccounts.length > 0 && (
        <div className="w-6 h-px bg-white/[0.07] my-0.5" />
      )}

      {/* Client icons */}
      {subaccounts.map(sa => {
        const isActive = sa.id === identity.activeClientId;
        const bg = avatarColor(sa.name);
        return (
          <div key={sa.id} className="relative w-full flex items-center justify-center">
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-[3px] bg-white" />
            )}
            <button
              onClick={() => identity.selectClient(sa)}
              title={sa.name}
              style={{ background: bg }}
              className={`w-9 h-9 border-none cursor-pointer text-white text-xs font-bold tracking-[-0.02em] flex items-center justify-center [font-family:inherit] transition-[border-radius,opacity,box-shadow] duration-150 ${
                isActive
                  ? 'rounded-[10px] opacity-100 shadow-[0_0_0_2px_rgba(255,255,255,0.2)]'
                  : 'rounded-[14px] opacity-[0.55] hover:opacity-[0.85]'
              }`}
            >
              {toInitials(sa.name)}
            </button>
            {sa.status !== 'active' && (
              <div className={`absolute bottom-0.5 right-[7px] w-2 h-2 rounded-full border-[1.5px] border-[#080e1a] ${
                sa.status === 'suspended' ? 'bg-amber-400' : 'bg-slate-500'
              }`} />
            )}
          </div>
        );
      })}

      {/* New Client button */}
      {identity.hasOrgContext && canCreateClient && (
        <button
          onClick={onCreateClient}
          title="New company"
          className="w-9 h-9 rounded-[14px] border border-dashed border-white/20 cursor-pointer bg-transparent text-white/40 hover:text-white/70 hover:border-white/40 text-lg font-light flex items-center justify-center transition-all duration-150"
        >
          +
        </button>
      )}

      <div className="flex-1" />

      {/* User avatar */}
      <button
        onClick={() => navigate('/settings')}
        title={`${user.firstName} ${user.lastName}`}
        className="w-8 h-8 rounded-lg border border-white/10 cursor-pointer bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-[11px] font-bold text-slate-200 [font-family:inherit]"
      >
        {userInitials}
      </button>
    </aside>
  );
}
