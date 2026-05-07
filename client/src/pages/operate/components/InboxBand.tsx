// client/src/pages/operate/components/InboxBand.tsx
//
// Collapsible wrapper for one inbox priority band.
// - Sticky header (position: sticky; top: 0) per spec §4.6
// - Default expanded for 'high' and 'needs_action'; collapsed for 'previous'
// - Renders <InboxItemCard> for each item
// - Renders <EmptyState> when items list is empty
// - Exposes onRemove callback so parent can propagate item removal
//
// Spec §4.6

import React, { useState } from 'react';
import type { InboxBand as InboxBandType, InboxItem } from '../../../../../shared/types/operate';
import type { User } from '../../../lib/auth';
import { EmptyState } from '../../../components/EmptyState';
import { InboxItemCard } from './InboxItemCard';

// ---------------------------------------------------------------------------
// Band label map
// ---------------------------------------------------------------------------

const BAND_LABELS: Record<InboxBandType, string> = {
  high: 'HIGH PRIORITY',
  needs_action: 'NEEDS ACTION',
  previous: 'PREVIOUS',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InboxBandProps {
  band: InboxBandType;
  items: InboxItem[];
  loading: boolean;
  error: string | null;
  user: User;
  /** Called when an item is actioned and should be removed from this band. */
  onRemove: (entityId: string) => void;
}

// ---------------------------------------------------------------------------
// InboxBand
// ---------------------------------------------------------------------------

export function InboxBand({
  band,
  items,
  loading,
  error,
  user,
  onRemove,
}: InboxBandProps): React.ReactElement {
  // Default: high and needs_action are expanded; previous is collapsed
  const defaultExpanded = band === 'high' || band === 'needs_action';
  const [expanded, setExpanded] = useState(defaultExpanded);

  const label = BAND_LABELS[band];
  const count = items.length;

  return (
    <div className="flex flex-col">
      {/* Sticky band header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-y border-slate-200 text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        style={{ position: 'sticky', top: 0, zIndex: 10 }}
        aria-expanded={expanded}
        aria-label={`${label} band — ${count} item${count !== 1 ? 's' : ''}`}
      >
        {/* Chevron */}
        <svg
          className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? 'rotate-90' : 'rotate-0'}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>

        {/* Label */}
        <span className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
          {label}
        </span>

        {/* Count badge */}
        {!loading && (
          <span className="ml-auto text-xs font-medium text-slate-500 tabular-nums">
            {count}
          </span>
        )}

        {loading && (
          <span className="ml-auto text-xs text-slate-400">Loading...</span>
        )}
      </button>

      {/* Band body — only when expanded */}
      {expanded && (
        <div className="p-4 flex flex-col gap-3">
          {/* Error state */}
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !error && (
            <div className="text-sm text-slate-400 py-2">Loading...</div>
          )}

          {/* Empty state */}
          {!loading && !error && items.length === 0 && (
            <EmptyState
              title={`No ${label.toLowerCase()} items`}
              body="Nothing here right now."
            />
          )}

          {/* Item cards */}
          {!loading && !error && items.length > 0 &&
            items.map((item) => (
              <InboxItemCard
                key={`${item.entityType}:${item.entityId}`}
                item={item}
                user={user}
                onRemove={onRemove}
              />
            ))
          }
        </div>
      )}
    </div>
  );
}

export default InboxBand;
