import { useEffect, useRef, useState } from 'react';
import api from '../lib/api';

interface DailyBucket {
  bucketDate: string;
  runsMeasuredEntries: number;
  entryUtility: number | null;
  blockUtility: number | null;
}

interface AgentUtilityRow {
  agentId: string;
  agentName: string;
  subaccountId: string | null;
  runsMeasuredEntries: number;
  runsUnmeasuredEntries: number;
  entryUtility30d: string | null;
  blockUtility30d: string | null;
}

interface MemoryUtilityPayload {
  agents: AgentUtilityRow[];
  dailySeries: DailyBucket[];
}

const BANNER_KEY = 'mem_utility_banner_v1';

function drawUtilityChart(
  canvas: HTMLCanvasElement,
  series: Array<number | null>,
  color: string,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.offsetWidth || 440;
  const H = 140;
  canvas.width = W * window.devicePixelRatio;
  canvas.height = H * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const PAD = { top: 10, right: 16, bottom: 28, left: 40 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  // Grid lines at 0%, 25%, 50%, 75%, 100%
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 1;
  [0, 25, 50, 75, 100].forEach((pct) => {
    const y = PAD.top + cH - (pct / 100) * cH;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + cW, y);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(pct + '%', PAD.left - 4, y + 4);
  });

  // Draw the line, breaking at null values
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let inPath = false;
  series.forEach((val, i) => {
    const x = PAD.left + (i / (series.length - 1)) * cW;
    if (val === null) {
      if (inPath) {
        ctx.stroke();
        inPath = false;
      }
      return;
    }
    const y = PAD.top + cH - Math.min(1, Math.max(0, val)) * cH;
    if (!inPath) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      inPath = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  if (inPath) ctx.stroke();

  // Dots for non-null values
  series.forEach((val, i) => {
    if (val === null) return;
    const x = PAD.left + (i / (series.length - 1)) * cW;
    const y = PAD.top + cH - Math.min(1, Math.max(0, val)) * cH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

function UtilityChart({
  series,
  label,
  sub,
  color,
}: {
  series: Array<number | null>;
  label: string;
  sub: string;
  color: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    drawUtilityChart(canvasRef.current, series, color);
  }, [series, color]);

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
      </div>
      <div className="p-4">
        <canvas ref={canvasRef} style={{ width: '100%', height: '140px' }} />
      </div>
    </div>
  );
}

function pctStr(val: string | null): string {
  if (val === null) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : (n * 100).toFixed(1) + '%';
}

export default function MemoryUtilityTab() {
  const [payload, setPayload] = useState<MemoryUtilityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(BANNER_KEY) === 'dismissed',
  );

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .get<{ organisationId: string }>('/api/auth/me')
      .then(({ data: me }) =>
        api.get<MemoryUtilityPayload>(`/api/orgs/${me.organisationId}/usage/memory-utility`),
      )
      .then(({ data }) => setPayload(data))
      .catch(() => setError('Failed to load memory utility data.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismissBanner() {
    localStorage.setItem(BANNER_KEY, 'dismissed');
    setBannerDismissed(true);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-36 bg-slate-100 rounded animate-pulse" />
        <div className="h-36 bg-slate-100 rounded animate-pulse" />
        <div className="h-24 bg-slate-100 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
        {error}
        <button type="button" onClick={load} className="ml-2 underline">
          Retry
        </button>
      </div>
    );
  }

  if (!payload) return null;

  const allNull = payload.agents.length === 0 && payload.dailySeries.every(
    (b) => b.entryUtility === null && b.blockUtility === null,
  );

  if (allNull) {
    return (
      <div className="text-sm text-slate-500 italic">
        No memory utility data yet. Once agents run with memory injected, metrics will appear here.
      </div>
    );
  }

  const entrySeries = payload.dailySeries.map((b) => b.entryUtility);
  const blockSeries = payload.dailySeries.map((b) => b.blockUtility);

  const sortedAgents = [...payload.agents].sort((a, b) => {
    const av = a.entryUtility30d === null ? -1 : parseFloat(a.entryUtility30d);
    const bv = b.entryUtility30d === null ? -1 : parseFloat(b.entryUtility30d);
    return bv - av;
  });

  return (
    <div>
      {!bannerDismissed && (
        <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded p-3 mb-4 text-xs text-slate-600">
          <span className="flex-1">
            Runs predating the entry-manifest migration are excluded from entry utility calculations.
            Agent table refreshes nightly; charts reflect live run data.
            Citation detection is heuristic, so figures are directional.
          </span>
          <button
            type="button"
            onClick={dismissBanner}
            className="text-slate-400 hover:text-slate-600 flex-shrink-0"
            aria-label="Dismiss"
          >
            x
          </button>
        </div>
      )}

      <UtilityChart
        series={entrySeries}
        label="Memory entry utility"
        sub="% of injected workspace-memory entries cited in run output, rolling 30 days"
        color="#6366f1"
      />

      <UtilityChart
        series={blockSeries}
        label="Memory block utility"
        sub="% of injected memory blocks cited in run output, rolling 30 days"
        color="#10b981"
      />

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-semibold text-slate-700">Agent</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Measured runs</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Unmeasured</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Entry utility</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Block utility</th>
            </tr>
          </thead>
          <tbody>
            {sortedAgents.map((a) => {
              const totalRuns = a.runsMeasuredEntries + a.runsUnmeasuredEntries;
              const insufficient = totalRuns < 10;
              return (
                <tr key={a.agentId} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 text-slate-800">{a.agentName}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{a.runsMeasuredEntries}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{a.runsUnmeasuredEntries}</td>
                  {insufficient ? (
                    <td colSpan={2} className="px-3 py-2 text-right text-slate-400 italic">
                      Insufficient data
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {pctStr(a.entryUtility30d)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {pctStr(a.blockUtility30d)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
