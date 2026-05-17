import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { logAndSwallow } from '../../lib/silentCatchHelper';
import Modal from '../Modal';
import { IncidentTimeline } from './IncidentTimeline';
import type { IncidentEvent } from './IncidentTimeline';

export interface SystemIncident {
  id: string;
  fingerprint: string;
  source: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  classification: string;
  status: 'open' | 'investigating' | 'remediating' | 'escalated' | 'resolved' | 'suppressed';
  summary: string;
  errorCode: string | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  organisationId: string | null;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'critical' ? 'bg-red-100 text-red-700'
    : severity === 'high' ? 'bg-orange-100 text-orange-700'
    : severity === 'medium' ? 'bg-yellow-100 text-yellow-700'
    : 'bg-slate-100 text-slate-600';
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>{severity}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const cls = status === 'escalated' ? 'bg-red-100 text-red-700'
    : status === 'open' ? 'bg-orange-100 text-orange-700'
    : status === 'investigating' || status === 'remediating' ? 'bg-blue-100 text-blue-700'
    : status === 'suppressed' ? 'bg-slate-200 text-slate-600'
    : 'bg-green-100 text-green-700';
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>{status}</span>;
}

export function IncidentDetailDrawer({
  incident,
  onClose,
  onRefresh,
}: {
  incident: SystemIncident;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showResolve, setShowResolve] = useState(false);
  const [showSuppress, setShowSuppress] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [suppressReason, setSuppressReason] = useState('');
  const [suppressDuration, setSuppressDuration] = useState<'24h' | '7d' | '30d' | 'permanent'>('24h');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get(`/api/system/incidents/${incident.id}`)
      .then(({ data }) => { setEvents(data.events ?? []); })
      .catch(logAndSwallow('SystemIncidentsPage: incident events fetch', { severity: 'critical' }))
      .finally(() => setLoadingEvents(false));
  }, [incident.id]);

  const ack = useCallback(async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/system/incidents/${incident.id}/ack`, {});
      onRefresh();
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? 'Failed to acknowledge');
    } finally {
      setSubmitting(false);
    }
  }, [incident.id, onRefresh]);

  const resolve = useCallback(async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/system/incidents/${incident.id}/resolve`, { resolutionNote: resolveNote || undefined });
      setShowResolve(false);
      onRefresh();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? 'Failed to resolve');
    } finally {
      setSubmitting(false);
    }
  }, [incident.id, resolveNote, onRefresh, onClose]);

  const suppress = useCallback(async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/system/incidents/${incident.id}/suppress`, {
        reason: suppressReason || 'Manual suppression',
        duration: suppressDuration,
      });
      setShowSuppress(false);
      onRefresh();
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? 'Failed to suppress');
    } finally {
      setSubmitting(false);
    }
  }, [incident.id, suppressReason, suppressDuration, onRefresh]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[520px] z-50 bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
              <span className="text-[11px] text-slate-500 font-mono">{incident.source}</span>
            </div>
            <h2 className="text-[15px] font-semibold text-slate-800 leading-snug">{incident.summary}</h2>
          </div>
          <button onClick={onClose} className="ml-4 text-slate-400 hover:text-slate-700 text-xl font-light">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <div className="text-red-600 text-[13px] bg-red-50 rounded p-2">{error}</div>}

          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div><span className="text-slate-500">Error code</span><div className="font-mono text-slate-800 mt-0.5">{incident.errorCode ?? '—'}</div></div>
            <div><span className="text-slate-500">Occurrences</span><div className="font-semibold text-slate-800 mt-0.5">{incident.occurrenceCount}</div></div>
            <div><span className="text-slate-500">First seen</span><div className="text-slate-800 mt-0.5">{new Date(incident.firstSeenAt).toLocaleString()}</div></div>
            <div><span className="text-slate-500">Last seen</span><div className="text-slate-800 mt-0.5">{new Date(incident.lastSeenAt).toLocaleString()}</div></div>
            {incident.organisationId && <div className="col-span-2"><span className="text-slate-500">Org ID</span><div className="font-mono text-slate-800 mt-0.5 text-[11px]">{incident.organisationId}</div></div>}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {incident.status === 'open' && (
              <button
                onClick={ack}
                disabled={submitting}
                className="btn btn-sm btn-primary"
              >
                Acknowledge
              </button>
            )}
            {incident.status !== 'resolved' && (
              <button
                onClick={() => setShowResolve(true)}
                className="btn btn-sm btn-success"
              >
                Resolve
              </button>
            )}
            <button
              onClick={() => setShowSuppress(true)}
              className="btn btn-sm btn-secondary"
            >
              Suppress
            </button>
          </div>

          <IncidentTimeline events={events} loading={loadingEvents} />
        </div>
      </div>

      {/* Resolve modal */}
      {showResolve && (
        <Modal title="Resolve incident" onClose={() => setShowResolve(false)}>
          <div className="space-y-3">
            <p className="text-[13px] text-slate-600">Add an optional resolution note.</p>
            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="Resolution note (optional)"
              rows={3}
              className="w-full text-[13px] border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowResolve(false)} className="btn btn-sm btn-ghost">Cancel</button>
              <button onClick={resolve} disabled={submitting} className="btn btn-sm btn-success">
                {submitting ? 'Resolving...' : 'Resolve'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Suppress modal */}
      {showSuppress && (
        <Modal title="Suppress incident" onClose={() => setShowSuppress(false)}>
          <div className="space-y-3">
            <p className="text-[13px] text-slate-600">Suppress this fingerprint. Future occurrences will be silently counted but not surfaced.</p>
            <input
              value={suppressReason}
              onChange={(e) => setSuppressReason(e.target.value)}
              placeholder="Reason (e.g. known flaky test)"
              className="w-full text-[13px] border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div>
              <label className="text-[12px] text-slate-600 block mb-1">Duration</label>
              <select
                value={suppressDuration}
                onChange={(e) => setSuppressDuration(e.target.value as '24h' | '7d' | '30d' | 'permanent')}
                className="w-full text-[13px] border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="permanent">Permanent</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSuppress(false)} className="btn btn-sm btn-ghost">Cancel</button>
              <button onClick={suppress} disabled={submitting} className="btn btn-sm btn-secondary">
                {submitting ? 'Suppressing...' : 'Suppress'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
