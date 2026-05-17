import { BreadcrumbBar } from './BreadcrumbBar';
import GlobalAskBar from '../global-ask-bar/GlobalAskBar';

interface TopBarProps {
  breadcrumbs: { label: string; to: string }[];
  hasOrgContext: boolean;
  onOpenCommandPalette(): void;
}

export function TopBar({ breadcrumbs, hasOrgContext, onOpenCommandPalette }: TopBarProps) {
  return (
    <div className="h-[42px] pr-4 pl-6 flex items-center bg-white border-b border-slate-200 shrink-0 text-[13px] gap-1.5">
      <div className="flex-1 flex items-center gap-1.5">
        <BreadcrumbBar items={breadcrumbs} />
      </div>
      {/* Global Ask Bar — always visible when org context exists */}
      {hasOrgContext && (
        <GlobalAskBar />
      )}
      {/* Cmd+K trigger */}
      <button
        onClick={onOpenCommandPalette}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer bg-slate-100 border border-slate-200 text-slate-400 text-xs [font-family:inherit] transition-[border-color,color] duration-100 hover:border-indigo-500 hover:text-indigo-500"
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span>Search</span>
        <span className="text-[10px] opacity-60">⌘K</span>
      </button>
    </div>
  );
}
