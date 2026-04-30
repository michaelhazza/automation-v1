import { useEffect, useRef, useState } from 'react';
import api from '../lib/api';
import { InvocationChannelTile } from './InvocationChannelTile';

// ── Inline HeartbeatTimeline (shared logic from AdminAgentEditPage) ──────────
function HeartbeatTimeline({
  agentName,
  intervalHours,
  offsetHours,
  offsetMinutes = 0,
}: {
  agentName: string;
  intervalHours: number;
  offsetHours: number;
  offsetMinutes?: number;
}) {
  const startMins = offsetHours * 60 + offsetMinutes;
  const runMins: number[] = [];
  for (let m = startMins; m < 24 * 60; m += intervalHours * 60) runMins.push(m);

  const fmtMin = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-[10px] px-[18px] py-[14px]">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-xs font-semibold text-gray-700 w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {agentName}
        </span>
        <span className="text-[11px] text-slate-400 w-[70px] shrink-0">every {intervalHours}h</span>
        <svg width="100%" height="28" viewBox="0 0 480 28" preserveAspectRatio="none" className="flex-1 min-w-0">
          <line x1="0" y1="14" x2="480" y2="14" stroke="#d1d5db" strokeWidth="1.5" />
          {[0, 4, 8, 12, 16, 20, 24].map((h) => (
            <line key={h} x1={h / 24 * 480} y1="10" x2={h / 24 * 480} y2="18" stroke="#d1d5db" strokeWidth="1" />
          ))}
          {runMins.map((m) => (
            <circle key={m} cx={m / (24 * 60) * 480} cy="14" r="5" fill="#6366f1" />
          ))}
        </svg>
      </div>
      <div className="flex justify-between pl-[202px] text-[10px] text-slate-400 mt-0.5">
        {[0, 4, 8, 12, 16, 20, 24].map((h) => (
          <span key={h}>{h === 24 ? '' : `${h}h`}</span>
        ))}
      </div>
      <div className="mt-2.5 pl-[202px] text-xs text-indigo-500 font-medium">
        Runs at: {runMins.map(fmtMin).join('  ·  ')}
      </div>
    </div>
  );
}

// ── Shared input style (matches AdminAgentEditPage) ──────────────────────────
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] text-slate-900 bg-white';

// ── Types ────────────────────────────────────────────────────────────────────

export type InvocationKind = 'scheduled' | 'webhook' | 'slack' | 'email' | 'sms' | 'mcp';

interface WebhookConfig {
  id: string;
  endpointUrl: string;
  authType: string;
  authSecret: string | null;
  authHeaderName: string | null;
  timeoutMs: number;
  retryCount: number;
  expectCallback: boolean;
}

// Partial AgentForm fields owned by this card
interface HeartbeatFields {
  agentName: string;
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number | null;
  heartbeatOffsetHours: number;
  heartbeatOffsetMinutes: number;
  concurrencyPolicy: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
  catchUpPolicy: 'skip_missed' | 'enqueue_missed_with_cap';
  catchUpCap: number;
  maxConcurrentRuns: number;
}

interface InvocationsCardProps extends HeartbeatFields {
  agentId: string;
  onChange: (fields: Partial<Record<string, unknown>>) => void;
}

// ── Tile row for accordion list ───────────────────────────────────────────────
function AccordionRow({
  icon,
  label,
  badge,
  isExpanded,
  onToggle,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  badge: { kind: 'active'; detail?: string } | { kind: 'setup' } | { kind: 'soon' };
  isExpanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const badgeClass =
    badge.kind === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
    badge.kind === 'setup'  ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              'bg-slate-100 text-slate-400 border border-slate-200';
  const badgeText =
    badge.kind === 'active' ? `Active${badge.detail ? ` · ${badge.detail}` : ''}` :
    badge.kind === 'setup'  ? 'Setup' :
                              'Soon';

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${isExpanded ? 'border-indigo-300' : 'border-slate-200'}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={disabled ? undefined : onToggle}
        className={[
          'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
          disabled
            ? 'opacity-50 cursor-not-allowed bg-white'
            : isExpanded
              ? 'bg-indigo-50'
              : 'bg-white hover:bg-slate-50 cursor-pointer',
        ].join(' ')}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0">{icon}</div>
        <span className="text-[13px] font-semibold text-slate-800 flex-1">{label}</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${badgeClass}`}>{badgeText}</span>
        {!disabled && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={`shrink-0 text-slate-400 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {isExpanded && children && (
        <div className="px-4 pb-4 pt-2 bg-white border-t border-slate-100">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function InvocationsCard(props: InvocationsCardProps) {
  const {
    agentId,
    agentName,
    heartbeatEnabled,
    heartbeatIntervalHours,
    heartbeatOffsetHours,
    heartbeatOffsetMinutes,
    concurrencyPolicy,
    catchUpPolicy,
    catchUpCap,
    maxConcurrentRuns,
    onChange,
  } = props;

  type TileKey = Exclude<InvocationKind, 'sms' | 'mcp'>; // clickable tiles only
  const [expandedTile, setExpandedTile] = useState<TileKey | null>(null);

  // Webhook state
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [webhookForm, setWebhookForm] = useState({ endpointUrl: '', authType: 'none', authSecret: '' });
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [showWebhookForm, setShowWebhookForm] = useState(false);

  // Slack state
  const [slackCount, setSlackCount] = useState(0);

  // Unmount guard for async state setters
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;

    api.get(`/api/agents/${agentId}/webhook-config`)
      .then(({ data }) => { if (!cancelled) setWebhookConfig(data); })
      .catch(() => { /* 404 means not configured — that's fine */ })
      .finally(() => { if (!cancelled) setWebhookLoading(false); });

    api.get(`/api/agents/${agentId}/slack-channel-count`)
      .then(({ data }) => { if (!cancelled) setSlackCount(data.count ?? 0); })
      .catch(() => { /* non-fatal */ });

    return () => { cancelled = true; };
  }, [agentId]);

  // Tile grid vs accordion toggle
  const handleTileClick = (tile: TileKey) => {
    setExpandedTile((prev) => (prev === tile ? null : tile));
  };

  // Webhook save
  const handleWebhookSave = async () => {
    if (!webhookForm.endpointUrl.trim()) {
      setWebhookError('Endpoint URL is required.');
      return;
    }
    setWebhookSaving(true);
    setWebhookError('');
    try {
      const { data } = await api.put(`/api/agents/${agentId}/webhook-config`, {
        endpointUrl: webhookForm.endpointUrl.trim(),
        authType: webhookForm.authType,
        authSecret: webhookForm.authSecret || null,
      });
      if (!mountedRef.current) return;
      setWebhookConfig(data);
      setShowWebhookForm(false);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Failed to save.'
        : 'Failed to save.';
      setWebhookError(msg);
    } finally {
      if (!mountedRef.current) return;
      setWebhookSaving(false);
    }
  };

  // ── Tile badge helpers ──
  const scheduledBadge: { kind: 'active' } | { kind: 'setup' } = heartbeatEnabled
    ? { kind: 'active' }
    : { kind: 'setup' };

  const webhookBadge: { kind: 'active' } | { kind: 'setup' } = !webhookLoading && webhookConfig
    ? { kind: 'active' }
    : { kind: 'setup' };

  const slackBadge: { kind: 'active'; detail: string } | { kind: 'setup' } = slackCount > 0
    ? { kind: 'active', detail: `${slackCount} channel${slackCount === 1 ? '' : 's'}` }
    : { kind: 'setup' };

  // ── Icons ──
  const ClockIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-indigo-500">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const WebhookIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-violet-500">
      <path d="M4 8a8 8 0 0 1 14.5-4.6M20 16a8 8 0 0 1-14.5 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 12h8M4 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
  const SlackIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-green-600">
      <rect x="9" y="2" width="3" height="7" rx="1.5" fill="currentColor" />
      <rect x="9" y="15" width="3" height="7" rx="1.5" fill="currentColor" />
      <rect x="2" y="9" width="7" height="3" rx="1.5" fill="currentColor" />
      <rect x="15" y="9" width="7" height="3" rx="1.5" fill="currentColor" />
      <rect x="2" y="9" width="3" height="3" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="15" y="9" width="3" height="3" rx="1.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
  const EmailIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-amber-500">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 8l9 6 9-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
  const SmsIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-slate-400">
      <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 20l4-3 4 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const McpIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-slate-400">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );

  const isGridMode = expandedTile === null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5">
      <h3 className="m-0 text-[15px] font-semibold text-slate-900">Invocations</h3>
      <p className="m-0 mt-1 text-xs text-slate-500">How this agent is triggered to run.</p>

      {isGridMode ? (
        /* ── Tile grid ── */
        <div className="grid grid-cols-3 gap-3 mt-4">
          <InvocationChannelTile
            icon={ClockIcon}
            label="Scheduled"
            badge={scheduledBadge}
            onClick={() => handleTileClick('scheduled')}
            isExpanded={false}
          />
          <InvocationChannelTile
            icon={WebhookIcon}
            label="Webhook"
            badge={webhookBadge}
            onClick={() => handleTileClick('webhook')}
            isExpanded={false}
          />
          <InvocationChannelTile
            icon={SlackIcon}
            label="Slack"
            badge={slackBadge}
            onClick={() => handleTileClick('slack')}
            isExpanded={false}
          />
          <InvocationChannelTile
            icon={EmailIcon}
            label="Email"
            badge={{ kind: 'setup' }}
            onClick={() => handleTileClick('email')}
            isExpanded={false}
          />
          <InvocationChannelTile
            icon={SmsIcon}
            label="SMS"
            badge={{ kind: 'soon' }}
            disabled
          />
          <InvocationChannelTile
            icon={McpIcon}
            label="MCP"
            badge={{ kind: 'soon' }}
            disabled
          />
        </div>
      ) : (
        /* ── Accordion list ── */
        <div className="flex flex-col gap-2 mt-4">

          {/* Scheduled */}
          <AccordionRow
            icon={ClockIcon}
            label="Scheduled"
            badge={scheduledBadge}
            isExpanded={expandedTile === 'scheduled'}
            onToggle={() => handleTileClick('scheduled')}
          >
            <p className="m-0 mb-[18px] text-[13.5px] text-slate-500 leading-relaxed">
              Heartbeats keep your agent active — it wakes up on a schedule, checks its tasks, and acts autonomously.
            </p>

            {/* Enable toggle */}
            <label className="flex items-center gap-2.5 cursor-pointer mb-5">
              <div
                onClick={() => onChange({ heartbeatEnabled: !heartbeatEnabled })}
                className={`w-10 h-[22px] rounded-[11px] relative cursor-pointer shrink-0 transition-colors duration-150 ${heartbeatEnabled ? 'bg-indigo-500' : 'bg-slate-200'}`}
              >
                <div className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-[left] duration-150 ${heartbeatEnabled ? 'left-[21px]' : 'left-[3px]'}`} />
              </div>
              <span className="text-[14px] font-semibold text-slate-900">Enable heartbeat</span>
            </label>

            {heartbeatEnabled && (
              <div className="flex flex-wrap items-end gap-5">
                {/* Start time */}
                <div>
                  <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Start time</div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={heartbeatOffsetHours}
                      onChange={(e) => onChange({ heartbeatOffsetHours: Number(e.target.value) })}
                      className={`${inputCls} w-[80px]`}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <span className="text-slate-400">:</span>
                    <select
                      value={heartbeatOffsetMinutes}
                      onChange={(e) => onChange({ heartbeatOffsetMinutes: Number(e.target.value) })}
                      className={`${inputCls} w-[80px]`}
                    >
                      {[0, 15, 30, 45].map((m) => (
                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Interval */}
                <div>
                  <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Repeat every</div>
                  <div className="flex gap-2 flex-wrap">
                    {([1, 2, 3, 4, 6, 8, 12, 24] as const).map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => onChange({ heartbeatIntervalHours: h })}
                        className={`px-3 py-1.5 rounded-lg border text-[13px] font-medium cursor-pointer transition-all duration-100 ${
                          heartbeatIntervalHours === h
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {h === 24 ? '1 day' : `${h}h`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timeline preview */}
                {heartbeatIntervalHours && (
                  <div className="w-full">
                    <div className="text-[13px] font-semibold text-gray-700 mb-2.5">Schedule preview (24h)</div>
                    <HeartbeatTimeline
                      agentName={agentName || 'This agent'}
                      intervalHours={heartbeatIntervalHours}
                      offsetHours={heartbeatOffsetHours}
                      offsetMinutes={heartbeatOffsetMinutes}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Divider before concurrency controls */}
            <div className="border-t border-slate-100 my-6" />
            <div className="text-[13px] font-semibold text-slate-700 mb-1">Concurrency</div>
            <div className="text-xs text-slate-500 mb-4">Control how overlapping and missed runs are handled.</div>

            <div className="flex flex-wrap gap-5">
              {/* Concurrency Policy */}
              <div className="min-w-[220px]">
                <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Concurrency Policy</div>
                <select
                  value={concurrencyPolicy}
                  onChange={(e) => onChange({ concurrencyPolicy: e.target.value })}
                  className={`${inputCls} w-full`}
                >
                  <option value="skip_if_active">Skip if active</option>
                  <option value="coalesce_if_active">Queue one (coalesce)</option>
                  <option value="always_enqueue">Queue all</option>
                </select>
                <div className="text-xs text-slate-400 mt-1">
                  {concurrencyPolicy === 'skip_if_active' && 'New runs are dropped while the agent is already running.'}
                  {concurrencyPolicy === 'coalesce_if_active' && 'At most one run is queued while the agent is active.'}
                  {concurrencyPolicy === 'always_enqueue' && 'Every triggered run is queued and executed in order.'}
                </div>
              </div>

              {/* Catch-up Policy */}
              <div className="min-w-[220px]">
                <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Catch-up Policy</div>
                <select
                  value={catchUpPolicy}
                  onChange={(e) => onChange({ catchUpPolicy: e.target.value })}
                  className={`${inputCls} w-full`}
                >
                  <option value="skip_missed">Skip missed</option>
                  <option value="enqueue_missed_with_cap">Catch up with cap</option>
                </select>
                <div className="text-xs text-slate-400 mt-1">
                  {catchUpPolicy === 'skip_missed' && 'Missed heartbeats are skipped — the next run starts at the next scheduled time.'}
                  {catchUpPolicy === 'enqueue_missed_with_cap' && `Up to ${catchUpCap} missed runs will be queued and executed.`}
                </div>
              </div>

              {/* Catch-up Cap */}
              {catchUpPolicy === 'enqueue_missed_with_cap' && (
                <div className="min-w-[140px]">
                  <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Catch-up Cap</div>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={catchUpCap}
                    onChange={(e) => onChange({ catchUpCap: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                    className={`${inputCls} w-[100px]`}
                  />
                  <div className="text-xs text-slate-400 mt-1">Max missed runs to catch up on.</div>
                </div>
              )}

              {/* Max Concurrent Runs */}
              <div className="min-w-[140px]">
                <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Max Concurrent Runs</div>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxConcurrentRuns}
                  onChange={(e) => onChange({ maxConcurrentRuns: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                  className={`${inputCls} w-[100px]`}
                />
                <div className="text-xs text-slate-400 mt-1">How many runs can execute simultaneously (1–10).</div>
              </div>
            </div>
          </AccordionRow>

          {/* Webhook */}
          <AccordionRow
            icon={WebhookIcon}
            label="Webhook"
            badge={webhookBadge}
            isExpanded={expandedTile === 'webhook'}
            onToggle={() => handleTileClick('webhook')}
          >
            {webhookConfig && !showWebhookForm ? (
              <div>
                <div className="text-[13px] text-slate-700 mb-3">
                  <span className="font-semibold text-slate-500 text-xs uppercase tracking-wide block mb-1">Endpoint URL</span>
                  <code className="text-[12px] bg-slate-50 border border-slate-200 rounded px-2 py-1 break-all">{webhookConfig.endpointUrl}</code>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setWebhookForm({ endpointUrl: webhookConfig.endpointUrl, authType: webhookConfig.authType, authSecret: '' });
                      setShowWebhookForm(true);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="m-0 mb-3 text-[13px] text-slate-500">
                  Configure an HTTP endpoint that this agent calls when triggered via webhook.
                </p>
                <div className="mb-3">
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Endpoint URL</label>
                  <input
                    type="url"
                    placeholder="https://example.com/webhook"
                    value={webhookForm.endpointUrl}
                    onChange={(e) => setWebhookForm((f) => ({ ...f, endpointUrl: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Auth type</label>
                  <select
                    value={webhookForm.authType}
                    onChange={(e) => setWebhookForm((f) => ({ ...f, authType: e.target.value }))}
                    className={`${inputCls} w-full`}
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="hmac_sha256">HMAC SHA-256</option>
                    <option value="api_key_header">API key header</option>
                  </select>
                </div>
                {webhookForm.authType !== 'none' && (
                  <div className="mb-3">
                    <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Secret</label>
                    <input
                      type="password"
                      placeholder="Enter secret (leave blank to keep existing)"
                      value={webhookForm.authSecret}
                      onChange={(e) => setWebhookForm((f) => ({ ...f, authSecret: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                )}
                {webhookError && <p className="text-xs text-red-500 mb-2">{webhookError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleWebhookSave}
                    disabled={webhookSaving}
                    className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-[13px] font-medium hover:bg-indigo-600 cursor-pointer disabled:opacity-60"
                  >
                    {webhookSaving ? 'Saving…' : 'Save'}
                  </button>
                  {(webhookConfig || showWebhookForm) && (
                    <button
                      type="button"
                      onClick={() => { setShowWebhookForm(false); setWebhookError(''); }}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}
          </AccordionRow>

          {/* Slack */}
          <AccordionRow
            icon={SlackIcon}
            label="Slack"
            badge={slackBadge}
            isExpanded={expandedTile === 'slack'}
            onToggle={() => handleTileClick('slack')}
          >
            {slackCount > 0 ? (
              <p className="m-0 text-[13px] text-slate-600">
                This agent is active in <strong>{slackCount}</strong> Slack channel{slackCount === 1 ? '' : 's'}.
                Manage channels from your Slack integration settings.
              </p>
            ) : (
              <p className="m-0 text-[13px] text-slate-500">
                No Slack channels connected yet. Configure Slack triggering from your workspace integration settings.
              </p>
            )}
          </AccordionRow>

          {/* Email */}
          <AccordionRow
            icon={EmailIcon}
            label="Email"
            badge={{ kind: 'setup' }}
            isExpanded={expandedTile === 'email'}
            onToggle={() => handleTileClick('email')}
          >
            <p className="m-0 text-[13px] text-slate-500">
              Email triggering is managed workspace-wide. Contact your admin to configure inbound email routing.
            </p>
          </AccordionRow>

          {/* SMS — disabled */}
          <AccordionRow
            icon={SmsIcon}
            label="SMS"
            badge={{ kind: 'soon' }}
            isExpanded={false}
            onToggle={() => {}}
            disabled
          />

          {/* MCP — disabled */}
          <AccordionRow
            icon={McpIcon}
            label="MCP"
            badge={{ kind: 'soon' }}
            isExpanded={false}
            onToggle={() => {}}
            disabled
          />
        </div>
      )}
    </div>
  );
}
