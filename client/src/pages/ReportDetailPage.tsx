import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { User } from '../lib/auth';
import api from '../lib/api';
import SkeletonLoader from '../components/SkeletonLoader';

interface Props { user: User; }

interface ReportDetail {
  id: string;
  title: string;
  generatedAt: string;
  htmlContent: string;
  totalClients: number;
  healthyCount: number;
  attentionCount: number;
  atRiskCount: number;
}

export default function ReportDetailPage({ user: _user }: Props) {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get(`/api/reports/${id}`)
      .then(({ data }) => setReport(data))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleResend = async () => {
    if (!id) return;
    setResending(true);
    try {
      await api.post(`/api/reports/${id}/resend`);
      toast.success('Report resent to your inbox.');
    } catch {
      toast.error('Failed to resend report. Please try again.');
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div className="h-8 w-64 bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md" />
        <SkeletonLoader variant="text-block" count={3} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-16">
        <p className="text-[15px] text-slate-500 mb-4">Report not found.</p>
        <Link to="/reports" className="text-indigo-600 font-semibold text-[14px] hover:text-indigo-700 no-underline">
          ← Back to reports
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link to="/reports" className="text-[13px] text-slate-400 hover:text-slate-600 no-underline mb-2 inline-block">
            ← All reports
          </Link>
          <h1 className="text-[24px] font-extrabold text-slate-900 tracking-tight m-0">{report.title}</h1>
          <p className="text-sm text-slate-500 mt-1">
            Generated {new Date(report.generatedAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button
          onClick={handleResend}
          disabled={resending}
          className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-[13.5px] text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors bg-white"
        >
          {resending ? (
            <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
          )}
          Resend to inbox
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] mb-6">
        {[
          { label: 'Total Clients', value: report.totalClients, color: 'slate' as const },
          { label: 'Healthy', value: report.healthyCount, color: 'green' as const },
          { label: 'Needs Attention', value: report.attentionCount, color: 'amber' as const },
          { label: 'At Risk', value: report.atRiskCount, color: 'red' as const },
        ].map(({ label, value, color }) => {
          const colors = {
            slate: 'bg-slate-50 border-slate-200 text-slate-900',
            green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
            amber: 'bg-amber-50 border-amber-200 text-amber-700',
            red: 'bg-red-50 border-red-200 text-red-700',
          };
          return (
            <div key={label} className={`${colors[color]} border rounded-xl p-4`}>
              <p className="text-[28px] font-extrabold leading-none mb-1">{value}</p>
              <p className="text-[12px] text-slate-500 font-medium">{label}</p>
            </div>
          );
        })}
      </div>

      {/* HTML report content */}
      {report.htmlContent ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <iframe
            srcDoc={report.htmlContent}
            title={report.title}
            className="w-full border-0"
            style={{ minHeight: '600px' }}
            sandbox="allow-same-origin"
            onLoad={(e) => {
              const iframe = e.currentTarget;
              const h = iframe.contentDocument?.documentElement?.scrollHeight;
              if (h) iframe.style.height = `${h}px`;
            }}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-[14px] text-slate-400">Full report content unavailable.</p>
        </div>
      )}
    </div>
  );
}
