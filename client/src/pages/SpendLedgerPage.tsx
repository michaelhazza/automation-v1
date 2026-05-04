import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import { User } from '../lib/auth';
import { useSocketRoom } from '../hooks/useSocket';
import { groupByIntent, flattenGroups } from '../components/spend/RetryGroupingPure';
import { aggregateBlockReasons } from '../components/spend/TopBlockReasonsAggregationPure';
import RetryGroupRow from '../components/spend/RetryGroupRow';
import TopBlockReasonsPanel from '../components/spend/TopBlockReasonsPanel';
import type { ChargeRow } from '../components/spend/RetryGroupingPure';
import type { ChargeForAggregation } from '../components/spend/TopBlockReasonsAggregationPure';

interface ChargeRecord extends ChargeRow, ChargeForAggregation {
  id: string;
  subaccountId: string;
  budgetId: string | null;
  reservedMinor: number;
  settledMinor: number;
}

interface SpendLedgerPageProps {
  user: User;
  /** read-only mode when user lacks spend_approver */
  readOnly?: boolean;
}

const ALL_STATUSES = ['settled', 'shadow_settled', 'blocked', 'denied', 'pending', 'reserved', 'failed'];

export default function SpendLedgerPage({ user: _user, readOnly = false }: SpendLedgerPageProps) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [charges, setCharges] = useState<ChargeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(false);
  const retryCountRef = useRef(0);
  const [groupingEnabled, setGroupingEnabled] = useState(true);
  const [currency, setCurrency] = useState<string>('USD');

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterMerchant, setFilterMerchant] = useState<string>('');
  const [filterMode, setFilterMode] = useState<string>('');

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!subaccountId) return;
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterMerchant) params.set('merchant', filterMerchant);
      if (filterMode) params.set('mode', filterMode);
      const { data } = await api.get(
        `/api/agent-charges?subaccountId=${subaccountId}${params.toString() ? '&' + params.toString() : ''}`
      );
      if (mountedRef.current) {
        const rows = (data?.charges ?? []) as ChargeRecord[];
        setCharges(rows);
        if (rows.length > 0) setCurrency(rows[0].currency);
        setFatalError(false);
      }
    } catch {
      if (mountedRef.current) {
        toast.error('Failed to load charges');
        retryCountRef.current += 1;
        if (retryCountRef.current >= 3) setFatalError(true);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [subaccountId, filterStatus, filterMerchant, filterMode]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // WebSocket live updates — reuse existing subaccount room
  useSocketRoom(
    'subaccount',
    subaccountId ?? '',
    {
      'agent_charge:created': () => load(),
      'agent_charge:updated': () => load(),
    },
    load,
  );

  // Backstop polling: 15s connected, 5s disconnected (managed by useSocketRoom)

  // Derived data
  const groups = groupByIntent(charges);
  const flatCharges = flattenGroups(groups);
  const blockReasons = aggregateBlockReasons(
    charges as ChargeForAggregation[],
    7,
    new Date(),
  );

  const settledMinor = charges
    .filter(c => c.status === 'settled' || c.status === 'shadow_settled')
    .reduce((s, c) => s + c.settledMinor, 0);
  const reservedMinor = charges
    .filter(c => c.status === 'reserved')
    .reduce((s, c) => s + c.reservedMinor, 0);

  if (fatalError) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4">
          <p className="text-[13px] font-semibold text-red-700 mb-1">Unable to load spend ledger</p>
          <p className="text-[12.5px] text-red-600 mb-3">
            Multiple attempts failed. Contact{' '}
            <a href="mailto:support@synthetos.ai" className="underline">support</a> if this persists.
          </p>
          <button
            onClick={() => { retryCountRef.current = 0; setFatalError(false); load(); }}
            className="px-3 py-1.5 text-[12.5px] font-semibold rounded-md bg-red-100 text-red-700 hover:bg-red-200 border-0 cursor-pointer [font-family:inherit]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[18px] font-bold text-slate-900">Spend Ledger</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Charges in {currency}{readOnly ? ' (read-only)' : ''}
          </p>
        </div>

        {/* Settled + reserved summary */}
        <div className="flex gap-4">
          <div className="text-right">
            <p className="text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Settled</p>
            <p className="text-[15px] font-bold text-slate-900 tabular-nums">
              {formatMinor(settledMinor, currency)}
            </p>
          </div>
          {reservedMinor > 0 && (
            <div className="text-right">
              <p className="text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">In-flight reserved</p>
              <p className="text-[14px] font-semibold text-indigo-600 tabular-nums">
                +{formatMinor(reservedMinor, currency)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Top block reasons */}
      {blockReasons.length > 0 && (
        <div className="mb-5">
          <TopBlockReasonsPanel reasons={blockReasons} windowDays={7} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-slate-200 rounded-md px-2.5 py-1.5 text-[12.5px] bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input
          type="text"
          value={filterMerchant}
          onChange={e => setFilterMerchant(e.target.value)}
          placeholder="Filter by merchant"
          className="border border-slate-200 rounded-md px-2.5 py-1.5 text-[12.5px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-44"
        />
        <select
          value={filterMode}
          onChange={e => setFilterMode(e.target.value)}
          className="border border-slate-200 rounded-md px-2.5 py-1.5 text-[12.5px] bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All modes</option>
          <option value="live">live</option>
          <option value="shadow">shadow</option>
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600 cursor-pointer select-none ml-auto">
          <input
            type="checkbox"
            checked={groupingEnabled}
            onChange={e => setGroupingEnabled(e.target.checked)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Group by intent
        </label>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : charges.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 mx-auto mb-3">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
            <p className="text-[14px] font-semibold text-slate-600 mb-1">No charges yet</p>
            <p className="text-[12.5px] text-slate-400 mb-3">
              Once an agent runs a spend skill, attempts will appear here.
            </p>
            <a
              href="https://docs.synthetos.ai/agentic-commerce"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12.5px] text-indigo-600 hover:text-indigo-700 no-underline hover:underline"
            >
              View spend skill docs
            </a>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th
                  className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-700"
                >
                  Time
                </th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Merchant</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide text-right">Amount</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Mode</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Reason</th>
              </tr>
            </thead>
            <tbody>
              {groupingEnabled
                ? groups.map(g => <RetryGroupRow key={g.intentId ?? g.latest.id} group={g} />)
                : flatCharges.map(row => (
                  <FlatChargeRow key={row.id} row={row} />
                ))
              }
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Flat row (grouping disabled) ───────────────────────────────────────────

import { formatSpendCardPure } from '../components/spend/formatSpendCardPure';

const FLAT_STATUS_STYLES: Record<string, string> = {
  settled:        'bg-green-100 text-green-800',
  shadow_settled: 'bg-slate-100 text-slate-600',
  blocked:        'bg-red-100 text-red-700',
  denied:         'bg-orange-100 text-orange-700',
  pending:        'bg-blue-100 text-blue-700',
  reserved:       'bg-indigo-100 text-indigo-700',
  failed:         'bg-red-100 text-red-700',
};

function FlatChargeRow({ row }: { row: ChargeRow }) {
  const fmt = formatSpendCardPure({
    amountMinor: row.amountMinor,
    currency: row.currency,
    merchantId: row.merchantId,
    merchantDescriptor: row.merchantDescriptor,
  });
  const statusCls = FLAT_STATUS_STYLES[row.status] ?? 'bg-slate-100 text-slate-600';
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-75">
      <td className="px-4 py-2.5 text-[12.5px] text-slate-600 w-[140px]">
        {new Date(row.createdAt).toLocaleString()}
      </td>
      <td className="px-4 py-2.5 text-[12.5px] font-medium text-slate-800">{fmt.merchantDisplay}</td>
      <td className="px-4 py-2.5 text-[12.5px] text-slate-700 text-right font-mono">{fmt.amountDisplay}</td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusCls}`}>
          {row.status.replace(/_/g, ' ')}
        </span>
      </td>
      <td className="px-4 py-2.5 text-[12px] text-slate-500">
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10.5px] font-medium ${row.mode === 'live' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {row.mode}
        </span>
      </td>
      <td className="px-4 py-2.5 text-[12px] text-slate-400 max-w-[180px] truncate">
        {row.failureReason ?? ''}
      </td>
    </tr>
  );
}

// ── Minor-unit display helper (page-local) ────────────────────────────────

const ZERO_DP = new Set(['JPY', 'KRW', 'BIF', 'CLP', 'GNF', 'ISK', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'XAF', 'XOF', 'XPF']);
const THREE_DP = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

function formatMinor(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const dp = ZERO_DP.has(code) ? 0 : THREE_DP.has(code) ? 3 : 2;
  const divisor = Math.pow(10, dp);
  const sym: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$',
    CHF: 'CHF', KRW: '₩', INR: '₹',
  };
  const s = sym[code] ?? code + ' ';
  return `${s}${(minor / divisor).toFixed(dp)}`;
}
