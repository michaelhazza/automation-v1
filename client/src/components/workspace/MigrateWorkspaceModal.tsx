import React, { useState, useEffect, useCallback, useRef } from 'react';
import { migrateWorkspace, getMigrationStatus } from '../../lib/api';

type TargetBackend = 'synthetos_native' | 'google_workspace';

interface PerIdentity {
  actorId: string;
  state: 'pending' | 'in_progress' | 'migrated' | 'failed' | 'skipped';
  reason?: string;
}

interface MigrationFailure {
  actorId: string;
  previousIdentityId: string;
  reason: string;
  retryable: boolean;
}

interface MigrationStatus {
  status: 'running' | 'success' | 'partial' | 'failed';
  total: number;
  migrated: number;
  failed: number;
  failures: MigrationFailure[];
  perIdentity: PerIdentity[];
}

interface Props {
  subaccountId: string;
  currentBackend: TargetBackend;
  targetBackend: TargetBackend;
  targetConnectorConfigId: string;
  onClose: () => void;
}

type Phase = 'confirm' | 'migrating' | 'success' | 'partial' | 'failed';

export function MigrateWorkspaceModal({
  subaccountId,
  currentBackend,
  targetBackend,
  targetConnectorConfigId,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [keyword, setKeyword] = useState('');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [migStatus, setMigStatus] = useState<MigrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const poll = useCallback(async (bid: string) => {
    try {
      const data: MigrationStatus = await getMigrationStatus(subaccountId, bid);
      setMigStatus(data);
      if (data.status !== 'running') {
        if (pollRef.current) clearInterval(pollRef.current);
        if (data.status === 'success') setPhase('success');
        else if (data.status === 'partial') setPhase('partial');
        else setPhase('failed');
      }
    } catch {
      // keep polling — transient error
    }
  }, [subaccountId]);

  async function handleMigrate() {
    if (keyword !== 'MIGRATE') return;
    setError(null);
    try {
      const migrationRequestId = crypto.randomUUID();
      const result = await migrateWorkspace(subaccountId, {
        targetBackend,
        targetConnectorConfigId,
        migrationRequestId,
      });
      const bid: string = result.migrationJobBatchId;
      setBatchId(bid);
      setPhase('migrating');
      // Start polling every 2 s
      pollRef.current = setInterval(() => poll(bid), 2000);
      poll(bid);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Migration failed to start');
    }
  }

  const backendLabel = (b: TargetBackend) =>
    b === 'synthetos_native' ? 'Synthetos native' : 'Google Workspace';

  const failedIdentities = migStatus?.failures ?? [];

  // suppress unused-variable warning for batchId (used for debugging / future use)
  void batchId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2">
              <span className="text-[12px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                {backendLabel(currentBackend)}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
              <span className="text-[12px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                {backendLabel(targetBackend)}
              </span>
              <span className="text-slate-900">Migrate workspace</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 flex-1 space-y-4">

          {phase === 'confirm' && (
            <>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">What will happen</p>
              <ol className="space-y-2">
                {[
                  'The current identity is archived (audit-anchor-only state).',
                  `A new identity is provisioned on ${backendLabel(targetBackend)}.`,
                  "The actor's actor_id links pre- and post-migration history. Audit trails stay queryable as a single record.",
                  'New mail / calendar / documents tag to the new identity. Old rows stay tagged to the archived identity.',
                ].map((step, i) => (
                  <li key={i} className="flex gap-3 text-[13px] text-slate-700">
                    <span className="w-5 h-5 flex-shrink-0 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-[11px] font-semibold">
                      {i + 1}
                    </span>
                    <span dangerouslySetInnerHTML={{ __html: step.replace(/actor_id/, '<code class="text-[11px] bg-slate-100 px-1 rounded">actor_id</code>') }} />
                  </li>
                ))}
              </ol>

              <div className="px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg text-[13px] text-blue-800 flex gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                Migration runs as queued jobs — one per agent identity. In-flight email is not interrupted.
              </div>

              {error && (
                <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Type <code className="text-indigo-700 font-mono">MIGRATE</code> to confirm
                </label>
                <input
                  className="w-full max-w-xs px-3 py-2 border border-slate-200 rounded-lg text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="MIGRATE"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                />
              </div>
            </>
          )}

          {phase === 'migrating' && (
            <div className="space-y-4">
              <p className="text-[13px] text-slate-700">Migration in progress…</p>
              {migStatus && (
                <>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-indigo-600 h-2 rounded-full transition-all"
                      style={{ width: migStatus.total > 0 ? `${((migStatus.migrated + migStatus.failed) / migStatus.total) * 100}%` : '0%' }}
                    />
                  </div>
                  <p className="text-[12px] text-slate-500">
                    {migStatus.migrated + migStatus.failed} / {migStatus.total} identities processed
                  </p>
                </>
              )}
            </div>
          )}

          {phase === 'success' && (
            <div className="text-center py-8 space-y-2">
              <div className="text-green-600 text-[32px]">&#10003;</div>
              <p className="text-[14px] font-semibold text-slate-900">
                All {migStatus?.migrated ?? migStatus?.total} identities migrated.
              </p>
            </div>
          )}

          {phase === 'partial' && (
            <div className="space-y-4">
              <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-[13px] text-amber-800">
                {migStatus?.migrated} of {migStatus?.total} identities migrated. {failedIdentities.length} failed.
              </div>
              {failedIdentities.length > 0 && (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-[13px]">
                  {failedIdentities.map(f => (
                    <div key={f.actorId} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="text-red-600 text-[11px] font-medium">FAILED</span>
                      <span className="flex-1 text-slate-700 font-mono text-[11px]">{f.actorId}</span>
                      <span className={`text-[11px] ${f.retryable ? 'text-amber-600' : 'text-slate-500'}`}>
                        {f.reason}{f.retryable ? ' (retryable)' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {phase === 'failed' && (
            <div className="text-center py-8 space-y-2">
              <p className="text-[14px] font-semibold text-slate-900">No identities migrated.</p>
              <p className="text-[13px] text-slate-500">
                {failedIdentities[0]?.reason ?? 'An error occurred.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-2 justify-end">
          {(phase === 'success') && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-[13px] bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Done
            </button>
          )}
          {(phase === 'partial' || phase === 'failed') && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-[13px] text-slate-600 hover:bg-slate-100 rounded">
                Close
              </button>
              <button
                onClick={() => { setPhase('confirm'); setKeyword(''); }}
                className="px-4 py-2 text-[13px] bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                {phase === 'partial' ? 'Retry failed' : 'Retry'}
              </button>
            </>
          )}
          {phase === 'confirm' && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-[13px] text-slate-600 hover:bg-slate-100 rounded">
                Cancel
              </button>
              <button
                onClick={handleMigrate}
                disabled={keyword !== 'MIGRATE'}
                className="px-4 py-2 text-[13px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Migrate
              </button>
            </>
          )}
          {phase === 'migrating' && (
            <span className="text-[12px] text-slate-400">Migration running — do not close this window.</span>
          )}
        </div>
      </div>
    </div>
  );
}
