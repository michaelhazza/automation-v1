import ViewModeSwitcher from '../ViewModeSwitcher';
import type { ViewMode } from '../ViewModeSwitcher';
import { NavItemRenderer } from './NavItemRenderer';
import TrialCountdown from './TrialCountdown';
import type { NavItemSpec } from '../../config/sidebar';
import type { LayoutIdentity } from '../../hooks/useLayoutIdentity';

interface SidebarShellProps {
  identity: LayoutIdentity;
  viewMode: ViewMode;
  availableModes: ReadonlyArray<ViewMode>;
  setViewMode(next: ViewMode): void;
  hasAnyOrgPerm: boolean;
  navItems: NavItemSpec[];
}

export function SidebarShell({
  identity,
  viewMode,
  availableModes,
  setViewMode,
  hasAnyOrgPerm,
  navItems,
}: SidebarShellProps) {
  return (
    <aside className="sidebar-scroll w-[220px] bg-slate-900 flex flex-col border-r border-white/5 shrink-0 overflow-y-auto overflow-x-hidden">
      {/* Context header */}
      <div className="px-[18px] pt-[14px] pb-3 border-b border-white/5">
        {identity.activeClientId && identity.activeClientName ? (
          <>
            <div className="text-[13px] font-bold text-slate-100 overflow-hidden text-ellipsis whitespace-nowrap">
              {identity.activeClientName}
            </div>
            <div className="text-[11px] text-slate-700 mt-0.5">Company workspace</div>
          </>
        ) : identity.hasOrgContext ? (
          <>
            <div className="text-[13px] font-bold text-slate-100">
              {identity.isSystemAdmin ? (identity.activeOrgName ?? 'Organisation') : 'Organisation'}
            </div>
            <div className="text-[11px] text-slate-700 mt-0.5">Org workspace</div>
          </>
        ) : identity.isSystemAdmin ? (
          <>
            <div className="text-[13px] font-bold text-slate-100">Platform</div>
            <div className="text-[11px] text-slate-700 mt-0.5">System admin</div>
          </>
        ) : (
          <div className="text-[13px] font-bold text-slate-100">Automation OS</div>
        )}
      </div>

      {/* ViewModeSwitcher — shown above nav when org-admin+ permissions exist */}
      {(identity.hasOrgContext && hasAnyOrgPerm) && (
        <div className="px-3 py-2 border-b border-white/5 flex justify-center">
          <ViewModeSwitcher
            value={viewMode}
            onChange={setViewMode}
            availableModes={availableModes}
          />
        </div>
      )}

      {/* Navigation — config-driven (all groups except footer) */}
      <div className="flex-1 py-1 overflow-y-auto overflow-x-hidden">
        <NavItemRenderer items={navItems.filter(s => s.group !== 'footer')} />
      </div>

      {/* Footer — trial countdown + support link; profile/signout from buildNavItems */}
      <div className="px-1.5 pt-1.5 pb-2 border-t border-white/5">
        <TrialCountdown />
        <NavItemRenderer items={navItems.filter(s => s.group === 'footer')} />
        <a
          href="mailto:support@synthetos.ai"
          className="flex items-center gap-[9px] px-3 py-[5px] mx-1.5 my-px rounded-[7px] text-slate-700 text-[12px] no-underline transition-[color,background] duration-100 hover:text-slate-400 hover:bg-white/[0.04]"
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>Need help?</span>
        </a>
      </div>
    </aside>
  );
}
