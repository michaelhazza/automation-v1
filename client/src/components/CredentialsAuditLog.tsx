import { useState, useEffect } from 'react';
import api from '../lib/api';
import { formatProviderName, formatAuditAction, formatAuditTimestamp } from './credentialsAuditLogFormatters.js';

interface AuditEntry {
  credentialId: string;
  action: 'issued' | 'refreshed' | 'revoked' | 'used';
  organisationId: string;
  subaccountId?: string | null;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

interface Props {
  subaccountId: string;
}

/**
 * Collapsed-by-default audit log for credential events in the last 30 days.
 * Fetches from GET /api/subaccounts/:id/credential-audit.
 */
export default function CredentialsAuditLog({ subaccountId }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    api
      .get(`/api/subaccounts/${subaccountId}/credential-audit`, {
        params: { sinceTimestamp: since, limit: 50 },
      })
      .then((r) => {
        setEntries(r.data as AuditEntry[]);
        setLoaded(true);
      })
      .catch(() => {
        setError('Failed to load credential events.');
      })
      .finally(() => setLoading(false));
  }, [open, loaded, subaccountId]);

  const providerLabelFromEntry = (entry: AuditEntry): string => {
    const meta = entry.metadata ?? {};
    const providerType = typeof meta.providerType === 'string' ? meta.providerType : null;
    return formatProviderName(providerType);
  };

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900 bg-transparent border-0 cursor-pointer p-0"
        aria-expanded={open}
      >
        <span
          className={`text-[10px] inline-block transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          &#9654;
        </span>
        Credential Audit Log
      </button>

      {open && (
        <div className="mt-3">
          {loading && (
            <p className="text-sm text-slate-500">Loading credential events...</p>
          )}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          {!loading && !error && entries.length === 0 && (
            <p className="text-sm text-slate-500">No credential events in the last 30 days.</p>
          )}
          {!loading && !error && entries.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {entries.map((entry, idx) => (
                <div key={`${entry.credentialId}-${idx}`} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {providerLabelFromEntry(entry)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      entry.action === 'revoked'
                        ? 'bg-red-100 text-red-700'
                        : entry.action === 'issued'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {formatAuditAction(entry.action)}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {formatAuditTimestamp(entry.occurredAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
