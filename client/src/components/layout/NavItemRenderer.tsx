import React from 'react';
import type { NavItemSpec } from '../../config/sidebar';
import { Icons } from './icons';
import { NavItem } from './NavItem';
import { NavButton } from './NavButton';
import { NavSection, NavSectionAction } from './NavSection';

function resolveIcon(iconKey: string | undefined): React.ReactNode {
  if (!iconKey) return null;
  if (iconKey.startsWith('emoji:')) {
    const emoji = iconKey.slice('emoji:'.length);
    return <span className="text-[13px] shrink-0 leading-none">{emoji}</span>;
  }
  if (iconKey.startsWith('project-dot:')) {
    const color = iconKey.slice('project-dot:'.length);
    return <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: color }} />;
  }
  const icon = (Icons as Record<string, () => React.ReactNode>)[iconKey];
  if (!icon) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('resolveIcon: unknown icon key', iconKey);
    }
    return null;
  }
  return icon();
}

function renderNavItem(spec: NavItemSpec): React.ReactNode {
  if (spec.kind === 'empty-hint') {
    return (
      <div key={spec.key} className="px-[18px] py-1 text-[11px] text-slate-600 italic">
        {spec.label}
      </div>
    );
  }
  if (spec.kind === 'section-header') {
    const action = spec.onClick
      ? <NavSectionAction onClick={spec.onClick} />
      : undefined;
    return <NavSection key={spec.key} label={spec.label ?? ''} action={action} />;
  }

  if (spec.kind === 'button') {
    // Special-case: New Task button uses bolt icon inline style
    if (spec.key === 'new-task') {
      return (
        <button
          type="button"
          key={spec.key}
          onClick={spec.onClick}
          className="flex items-center gap-[9px] px-3 py-[7px] mx-1.5 my-px rounded-[7px] text-[13px] font-medium border-0 cursor-pointer transition-[color,background] duration-100 text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] bg-transparent w-[calc(100%-12px)] text-left [font-family:inherit]"
        >
          <span><Icons.bolt /></span>
          <span className="flex-1">{spec.label}</span>
        </button>
      );
    }
    // Special-case: sign-out uses the original footer button styling (slate-600 base)
    if (spec.key === 'sign-out') {
      return (
        <button
          type="button"
          key={spec.key}
          onClick={spec.onClick}
          className="flex items-center gap-[9px] px-3 py-[7px] w-[calc(100%-12px)] mx-1.5 my-px border-none cursor-pointer rounded-[7px] bg-transparent text-slate-600 text-[13px] font-medium [font-family:inherit] transition-[color,background] duration-100 hover:text-slate-100 hover:bg-white/[0.04]"
        >
          <Icons.logout />
          <span>{spec.label}</span>
        </button>
      );
    }
    return (
      <NavButton
        key={spec.key}
        icon={resolveIcon(spec.iconKey)}
        label={spec.label ?? ''}
        onClick={spec.onClick ?? (() => {})}
      />
    );
  }

  // kind === 'link'
  if (!spec.to) return null;
  return (
    <NavItem
      key={spec.key}
      to={spec.to}
      icon={resolveIcon(spec.iconKey)}
      label={spec.label ?? ''}
      badge={spec.badge}
      badgeLabel={spec.badgeLabel}
      exact={spec.exact}
      manageTo={spec.manageTo}
    />
  );
}

export function NavItemRenderer({ items }: { items: NavItemSpec[] }) {
  return <>{items.map(spec => renderNavItem(spec))}</>;
}
