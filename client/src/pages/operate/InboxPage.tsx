// client/src/pages/operate/InboxPage.tsx
//
// Operate > Inbox page.
// - <SearchBox> with 200ms debounce wired to `q`
// - Three <InboxBand> components in spec §4.6 order:
//   HIGH PRIORITY → NEEDS ACTION → PREVIOUS
// - Each band fetches independently (parallel on mount; refetch on q change)
// - Each band has its own requestSeq ref for latest-request-wins stale-response discard
// - Empty band → <EmptyState> inside the band
// - All three bands empty → page-level <EmptyState>
// - No snooze (deferred per spec §10 / plan resolved gaps)
//
// Spec §4.2 (consumer side), §4.6 (band UX), §4.7 (search), §4.10 (inline reject, no archive confirm)

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from '../../lib/auth';
import type { InboxBand as InboxBandType, InboxItem } from '../../../../shared/types/operate';
import { fetchInbox } from '../../lib/api';
import { PageShell } from '../../components/PageShell';
import { SearchBox } from '../../components/SearchBox';
import { EmptyState } from '../../components/EmptyState';
import { InboxBand } from './components/InboxBand';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InboxPageProps {
  user: User;
}

// ---------------------------------------------------------------------------
// Band state shape
// ---------------------------------------------------------------------------

interface BandState {
  items: InboxItem[];
  loading: boolean;
  error: string | null;
}

const EMPTY_BAND_STATE: BandState = { items: [], loading: true, error: null };

// Bands rendered in spec §4.6 order
const BAND_ORDER: InboxBandType[] = ['high', 'needs_action', 'previous'];

// ---------------------------------------------------------------------------
// InboxPage
// ---------------------------------------------------------------------------

export function InboxPage({ user }: InboxPageProps): React.ReactElement {
  // Search query (debounced via <SearchBox>)
  const [q, setQ] = useState('');

  // Per-band state
  const [bandStates, setBandStates] = useState<Record<InboxBandType, BandState>>({
    high: { ...EMPTY_BAND_STATE },
    needs_action: { ...EMPTY_BAND_STATE },
    previous: { ...EMPTY_BAND_STATE },
  });

  // Monotonic request sequence per band (latest-request-wins stale-response guard).
  // Stored in a stable useRef map so loadBand's closure is never stale.
  const seqCounters = useRef<Record<InboxBandType, number>>({
    high: 0,
    needs_action: 0,
    previous: 0,
  });

  // ---------------------------------------------------------------------------
  // Fetch one band
  // ---------------------------------------------------------------------------

  const loadBand = useCallback((band: InboxBandType, searchQ: string) => {
    const seq = ++seqCounters.current[band];

    setBandStates((prev) => ({
      ...prev,
      [band]: { ...prev[band], loading: true, error: null },
    }));

    fetchInbox({ band, q: searchQ || undefined })
      .then((data) => {
        // Stale-response guard: discard if a newer request was dispatched for this band
        if (seqCounters.current[band] !== seq) return;
        setBandStates((prev) => ({
          ...prev,
          [band]: { items: data.items, loading: false, error: null },
        }));
      })
      .catch((err) => {
        if (seqCounters.current[band] !== seq) return;
        console.error(`[InboxPage] fetchInbox(${band}) error:`, err);
        setBandStates((prev) => ({
          ...prev,
          [band]: { items: [], loading: false, error: 'Failed to load. Please try again.' },
        }));
      });
  // seqCounters is a stable ref — no deps needed
  }, []);

  // ---------------------------------------------------------------------------
  // Load all bands in parallel on mount and on q change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    for (const band of BAND_ORDER) {
      loadBand(band, q);
    }
  }, [loadBand, q]);

  // ---------------------------------------------------------------------------
  // Item removal handler (optimistic remove on action success)
  // ---------------------------------------------------------------------------

  const handleRemove = useCallback((band: InboxBandType, entityId: string) => {
    setBandStates((prev) => ({
      ...prev,
      [band]: {
        ...prev[band],
        items: prev[band].items.filter((item) => item.entityId !== entityId),
      },
    }));
  }, []);

  // ---------------------------------------------------------------------------
  // Determine if all three bands are empty (for page-level EmptyState)
  // ---------------------------------------------------------------------------

  const allLoading = BAND_ORDER.every((b) => bandStates[b].loading);
  const allEmpty = BAND_ORDER.every(
    (b) => !bandStates[b].loading && !bandStates[b].error && bandStates[b].items.length === 0,
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <PageShell
      header={
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-slate-900">Inbox</h1>
        </div>
      }
    >
      <div className="p-6 flex flex-col gap-4">
        {/* Search */}
        <div className="max-w-sm">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Search inbox..."
            debounceMs={200}
            aria-label="Search inbox"
          />
        </div>

        {/* Page-level empty state (all bands empty, not loading, no errors) */}
        {!allLoading && allEmpty && (
          <EmptyState
            title="Inbox is empty"
            body={
              q
                ? `No results for "${q}". Try adjusting your search.`
                : 'Nothing requires your attention right now.'
            }
            primaryAction={
              q ? { label: 'Clear search', onClick: () => setQ('') } : undefined
            }
          />
        )}

        {/* Three priority bands in spec §4.6 order */}
        {(!allEmpty || allLoading) && (
          <div className="flex flex-col border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-200">
            {BAND_ORDER.map((band) => (
              <InboxBand
                key={band}
                band={band}
                items={bandStates[band].items}
                loading={bandStates[band].loading}
                error={bandStates[band].error}
                user={user}
                onRemove={(entityId) => handleRemove(band, entityId)}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

export default InboxPage;
