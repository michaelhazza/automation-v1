// client/src/components/WorkspaceBadge.tsx
//
// Workspace identity badge — pill or inline text, optionally clickable.

import React from 'react';
import { getUserRole } from '../lib/auth';
import { hashToColor, DEFAULT_WORKSPACE_PALETTE } from '../lib/colorHash';
import { switchWorkspace } from '../lib/workspace';

export interface WorkspaceBadgeProps {
  clientId: string;
  clientName: string;
  variant?: 'pill' | 'inline';
  clickable?: boolean;
}

// Maps Tailwind color names from DEFAULT_WORKSPACE_PALETTE to background/text token pairs.
// Kept inline so WorkspaceBadge has zero Tailwind tooling dependency at runtime.
const COLOR_STYLES: Record<string, { background: string; color: string }> = {
  indigo:  { background: '#e0e7ff', color: '#3730a3' },
  amber:   { background: '#fef3c7', color: '#92400e' },
  emerald: { background: '#d1fae5', color: '#065f46' },
  red:     { background: '#fee2e2', color: '#991b1b' },
  sky:     { background: '#e0f2fe', color: '#075985' },
  slate:   { background: '#f1f5f9', color: '#334155' },
};

function resolveColorStyle(colorName: string): { background: string; color: string } {
  return COLOR_STYLES[colorName] ?? COLOR_STYLES[DEFAULT_WORKSPACE_PALETTE[0]];
}

function isOrgAdmin(): boolean {
  const role = getUserRole();
  return role === 'org_admin' || role === 'system_admin';
}

export function WorkspaceBadge({
  clientId,
  clientName,
  variant = 'pill',
  clickable,
}: WorkspaceBadgeProps): React.ReactElement {
  // Determine effective clickability: explicitly provided value wins; otherwise derive from role.
  const effectiveClickable = clickable !== undefined ? clickable : isOrgAdmin();

  const colorName = hashToColor(clientName || '');
  const { background, color } = resolveColorStyle(colorName);

  const label = clientName || 'Unknown workspace';

  const handleClick = () => {
    if (effectiveClickable && clientId) {
      switchWorkspace(clientId, clientName);
    }
  };

  if (variant === 'inline') {
    // Unstyled tinted text — no pill chrome
    return (
      <span
        style={{ color }}
        title={effectiveClickable ? `Switch to ${label} workspace` : label}
        onClick={effectiveClickable ? handleClick : undefined}
        role={effectiveClickable ? 'button' : undefined}
        tabIndex={effectiveClickable ? 0 : undefined}
        onKeyDown={
          effectiveClickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClick();
                }
              }
            : undefined
        }
        className={effectiveClickable ? 'workspace-badge-inline workspace-badge--clickable' : 'workspace-badge-inline'}
      >
        {label}
      </span>
    );
  }

  // Pill variant
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 500,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        background,
        color,
        cursor: effectiveClickable ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      title={label}
      onClick={effectiveClickable ? handleClick : undefined}
      role={effectiveClickable ? 'button' : undefined}
      tabIndex={effectiveClickable ? 0 : undefined}
      onKeyDown={
        effectiveClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      className={effectiveClickable ? 'workspace-badge workspace-badge--clickable' : 'workspace-badge'}
    >
      {label}
    </span>
  );
}
