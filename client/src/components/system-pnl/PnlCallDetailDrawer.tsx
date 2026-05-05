import { useEffect, useState } from 'react';
import type { CallDetail } from '../../../../shared/types/systemPnl';
import api from '../../lib/api';
import { fmtCurrency, fmtInt, fmtLatencyMs } from './PnlFormat';

interface Props {
  callId:   string | null;
  onClose:  () => void;
}

export default function PnlCallDetailDrawer({ callId, onClose }: Props) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!callId) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api.get(`/api/admin/llm-pnl/call/${callId}`)
      .then((r) => setDetail(r.data.data as CallDetail))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load call detail'))
      .finally(() => setLoading(false));
  }, [callId]);

  if (!callId) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end" aria-modal="true" role="dialog">
      <div className="fixed inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg h-full shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-900">LLM call detail</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900 text-sm"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        {loading && <div className="px-5 py-6 text-sm text-slate-500">Loading…</div>}
        {error && <div className="px-5 py-6 text-sm text-rose-600">{error}</div>}
        {detail && <DetailBody detail={detail} />}
      </div>
    </div>
  );
}

function DetailBody({ detail }: { detail: CallDetail }) {
  return (
    <div className="px-5 py-5 text-sm space-y-5">
      <Section title="Identity">
        <Row label="Provider request ID" value={detail.providerRequestId ?? '—'} copyable />
        <Row label="Idempotency key" value={detail.idempotencyKey} copyable />
        <Row label="Source" value={detail.sourceLabel} />
        <Row label="Status" value={detail.status} />
        <Row label="Attempt #" value={String(detail.attemptNumber)} />
      </Section>

      <Section title="Attribution">
        {detail.organisationName && <Row label="Organisation" value={detail.organisationName} />}
        {detail.subaccountName && <Row label="Subaccount" value={detail.subaccountName} />}
        {detail.marginTier !== null && <Row label="Margin tier" value={`${detail.marginTier.toFixed(2)}×`} />}
        {detail.runId && <Row label="Run ID" value={detail.runId} copyable />}
        {detail.sourceId && <Row label="Source ID (job)" value={detail.sourceId} copyable />}
      </Section>

      <Section title="Usage">
        <Row label="Tokens in / out" value={`${fmtInt(detail.tokensIn)} / ${fmtInt(detail.tokensOut)}`} />
        <Row label="Cached prompt tokens" value={fmtInt(detail.cachedPromptTokens)} />
        <Row label="Provider latency" value={fmtLatencyMs(detail.providerLatencyMs)} />
        <Row label="Router overhead" value={fmtLatencyMs(detail.routerOverheadMs)} />
      </Section>

      <Section title="Money">
        <Row label="Revenue" value={fmtCurrency(detail.revenueCents)} />
        <Row label="Cost" value={fmtCurrency(detail.costCents)} />
        <Row label="Profit" value={fmtCurrency(detail.profitCents)} />
      </Section>

      {(detail.errorMessage || detail.abortReason || detail.parseFailureRawExcerpt) && (
        <Section title="Failure context">
          {detail.errorMessage && <Row label="Error" value={detail.errorMessage} />}
          {detail.abortReason && <Row label="Abort reason" value={detail.abortReason} />}
          {detail.parseFailureRawExcerpt && (
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Parse-failure excerpt (≤2 KB)</div>
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono whitespace-pre-wrap break-words">
                {detail.parseFailureRawExcerpt}
              </pre>
            </div>
          )}
        </Section>
      )}

      {detail.fallbackChain !== null && (
        <Section title="Fallback chain">
          <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono whitespace-pre-wrap">
            {JSON.stringify(detail.fallbackChain, null, 2)}
          </pre>
        </Section>
      )}

      <div className="pt-3 border-t border-slate-200">
        <button
          onClick={() => copyTicket(detail)}
          className="btn btn-primary btn-sm"
        >
          Copy as support ticket
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs text-slate-900 text-right tabular-nums break-all">
        {value}
        {copyable && (
          <button
            onClick={() => navigator.clipboard?.writeText(value)}
            className="ml-2 text-indigo-600 hover:text-indigo-700"
            aria-label="Copy"
          >
            copy
          </button>
        )}
      </span>
    </div>
  );
}

function copyTicket(detail: CallDetail) {
  const lines = [
    `Provider: ${detail.provider}`,
    `Model: ${detail.model}`,
    `Provider request ID: ${detail.providerRequestId ?? '(none)'}`,
    `Status: ${detail.status}`,
    `Attempt: ${detail.attemptNumber}`,
    detail.errorMessage ? `Error: ${detail.errorMessage}` : null,
    detail.abortReason ? `Abort reason: ${detail.abortReason}` : null,
    `Tokens in/out: ${detail.tokensIn} / ${detail.tokensOut}`,
    `Latency: provider ${detail.providerLatencyMs ?? '—'}ms + router ${detail.routerOverheadMs ?? '—'}ms`,
    `Ledger ID: ${detail.id}`,
  ].filter(Boolean).join('\n');
  navigator.clipboard?.writeText(lines);
}
