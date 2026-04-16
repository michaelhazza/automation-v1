/**
 * DropZone — drag-and-drop upload + destination proposal confirmation (S9)
 *
 * Phase 4 scope: renders upload surface, proposal checkboxes with confidence
 * scores per §5.5 (pre-ticked >0.8, shown 0.5-0.8, hidden <0.5 behind "Show more").
 * Supports custom destination entry.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.5 (S9)
 */

import { useState } from 'react';
import api from '../lib/api';

type DestinationKind =
  | 'task_attachment'
  | 'memory_block'
  | 'subaccount_reference'
  | 'org_reference';

interface Destination {
  kind: DestinationKind;
  targetId: string;
  label: string;
  confidence: number;
  userAdded?: boolean;
}

interface Proposal {
  uploadId: string;
  fileName: string;
  fileHash: string;
  proposed: Destination[];
  requiresApproval: boolean;
  trustState: { approvedCount: number; trustedAt: string | null };
}

interface DropZoneProps {
  subaccountId: string;
  uploaderRole?: 'agency_staff' | 'client_contact';
}

export default function DropZone({ subaccountId, uploaderRole = 'agency_staff' }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showMore, setShowMore] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploaderRole', uploaderRole);
      const res = await api.post<Proposal>(
        `/api/subaccounts/${subaccountId}/drop-zone/upload`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      setProposal(res.data);
      // Pre-tick high-confidence destinations (>0.8)
      const preTicked = new Set<string>();
      for (const d of res.data.proposed) {
        if (d.confidence > 0.8) preTicked.add(destKey(d));
      }
      setSelected(preTicked);
    } catch {
      setError('Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function confirm() {
    if (!proposal) return;
    setUploading(true);
    try {
      const selectedDests = proposal.proposed.filter((d) => selected.has(destKey(d)));
      // Custom destinations
      if (customLabel.trim().length > 0) {
        selectedDests.push({
          kind: 'subaccount_reference',
          targetId: 'new',
          label: customLabel.trim(),
          confidence: 1.0,
          userAdded: true,
        });
      }
      await api.post(
        `/api/subaccounts/${subaccountId}/drop-zone/proposals/${proposal.uploadId}/confirm`,
        {
          selectedDestinations: selectedDests,
          uploaderRole,
        },
      );
      setProposal(null);
      setSelected(new Set());
      setCustomLabel('');
    } catch {
      setError('Confirm failed.');
    } finally {
      setUploading(false);
    }
  }

  function toggle(d: Destination) {
    const key = destKey(d);
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  }

  const highConf = proposal?.proposed.filter((d) => d.confidence >= 0.8) ?? [];
  const midConf = proposal?.proposed.filter((d) => d.confidence >= 0.5 && d.confidence < 0.8) ?? [];
  const lowConf = proposal?.proposed.filter((d) => d.confidence < 0.5) ?? [];

  return (
    <div>
      {!proposal && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
          }}
          className={`border-2 border-dashed rounded-lg p-8 text-center ${
            dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'
          }`}
        >
          <p className="text-sm text-slate-600 mb-2">Drop a document here, or click to pick a file.</p>
          <input
            type="file"
            onChange={(e) => {
              if (e.target.files?.[0]) upload(e.target.files[0]);
            }}
            disabled={uploading}
            className="text-sm"
          />
        </div>
      )}

      {uploading && <div className="mt-2 text-sm text-slate-500">Processing…</div>}
      {error && <div className="mt-2 text-sm text-red-600">{error}</div>}

      {proposal && (
        <div className="mt-4 border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">
            Proposed destinations for {proposal.fileName}
          </h3>
          {proposal.requiresApproval && (
            <p className="text-xs text-amber-700 mb-2">
              First-time client uploads require agency approval ({proposal.trustState.approvedCount}
              /5 approvals completed).
            </p>
          )}

          <DestList items={highConf} selected={selected} onToggle={toggle} subtitle="High confidence — pre-ticked" />
          <DestList items={midConf} selected={selected} onToggle={toggle} subtitle="Medium confidence" />

          {lowConf.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="text-xs text-indigo-600 hover:underline"
              >
                {showMore ? 'Hide' : 'Show'} {lowConf.length} more destination{lowConf.length === 1 ? '' : 's'}
              </button>
              {showMore && <DestList items={lowConf} selected={selected} onToggle={toggle} subtitle="Low confidence" />}
            </div>
          )}

          <div className="mt-3">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">
              Custom destination (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. 'New onboarding pack for Acme'"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => setProposal(null)}
              className="px-3 py-1.5 rounded-md border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={uploading}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Confirm &amp; file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DestList({
  items,
  selected,
  onToggle,
  subtitle,
}: {
  items: Destination[];
  selected: Set<string>;
  onToggle: (d: Destination) => void;
  subtitle: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
        {subtitle}
      </p>
      {items.map((d) => (
        <label key={destKey(d)} className="flex items-start gap-2 text-sm mb-1 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(destKey(d))}
            onChange={() => onToggle(d)}
            className="mt-0.5"
          />
          <span className="text-slate-700">
            {d.label}{' '}
            <span className="text-xs text-slate-400">
              ({Math.round(d.confidence * 100)}% match)
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function destKey(d: Destination): string {
  return `${d.kind}:${d.targetId}:${d.label}`;
}
