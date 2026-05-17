import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { AppRoute } from '../../config/routes';

export function NavItem({
  to, icon, label, badge, badgeLabel, exact = false, manageTo,
}: { to: string | AppRoute; icon: React.ReactNode; label: string; badge?: number; badgeLabel?: string; exact?: boolean; manageTo?: string | AppRoute }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const baseTo = to.split('?')[0]; // ignore query params for matching
  const active = exact ? pathname === baseTo : pathname === baseTo || pathname.startsWith(baseTo + '/');
  return (
    <Link
      to={to}
      className={`group flex items-center gap-[9px] px-3 py-[7px] mx-1.5 my-px rounded-[7px] text-[13px] font-medium no-underline transition-[color,background] duration-100 ${
        active
          ? 'text-slate-100 bg-white/[0.08]'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
      }`}
    >
      <span className={active ? 'text-indigo-300' : ''}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badgeLabel ? (
        <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-400">
          <span className="w-[6px] h-[6px] rounded-full bg-blue-400 animate-pulse" />
          {badgeLabel}
        </span>
      ) : !!badge && badge > 0 ? (
        <span className="min-w-[18px] h-[18px] rounded-[9px] px-[5px] bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
      {manageTo ? (
        <button
          type="button"
          title="Manage"
          aria-label={`Manage ${label}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(manageTo); }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-[18px] h-[18px] flex items-center justify-center rounded text-slate-500 hover:text-slate-200 hover:bg-white/[0.10] border-0 bg-transparent cursor-pointer transition-opacity p-0 shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      ) : null}
    </Link>
  );
}
