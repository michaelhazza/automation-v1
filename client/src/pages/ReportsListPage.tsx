import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User } from '../lib/auth';
import api from '../lib/api';
import { TablePageSkeleton } from '../components/SkeletonLoader';

interface Props { user: User; }

interface Report {
  id: string;
  title: string;
  generatedAt: string;
  totalClients: number;
  healthyCount: number;
  attentionCount: number;
  atRiskCount: number;
  status: 'complete' | 'generating' | 'error';
}

export default function ReportsListPage({ user: _user }: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/reports')
      .then(({ data }) => setReports(data.reports ?? []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <TablePageSkeleton rows={6} />;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-900 tracking-tight m-0">Reports</h1>
          <p className="text-sm text-slate-500 mt-1">Weekly portfolio health reports, auto-generated every Monday.</p>
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <h2 className="text-[17px] font-bold text-slate-900 mb-2">No reports yet</h2>
          <p className="text-[13.5px] text-slate-500 max-w-xs mx-auto mb-5">
            Your first report will be generated after your initial data sync completes.
          </p>
          <Link
            to="/clientpulse"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-semibold rounded-lg transition-colors no-underline"
          >
            Back to dashboard
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Report</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Generated</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Healthy</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold text-amber-600 uppercase tracking-wider">Attention</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold text-red-600 uppercase tracking-wider">At Risk</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Clients</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-900 text-[13.5px]">{report.title}</p>
                    {report.status === 'generating' && (
                      <span className="text-[11px] text-indigo-500 font-medium">Generating...</span>
                    )}
                    {report.status === 'error' && (
                      <span className="text-[11px] text-red-500 font-medium">Generation failed</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-[13px] text-slate-500">
                    {new Date(report.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-[14px] font-bold text-emerald-600">{report.healthyCount}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-[14px] font-bold text-amber-600">{report.attentionCount}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-[14px] font-bold text-red-600">{report.atRiskCount}</span>
                  </td>
                  <td className="px-5 py-4 text-right text-[13px] text-slate-500">{report.totalClients}</td>
                  <td className="px-5 py-4 text-right">
                    {report.status === 'complete' && (
                      <Link
                        to={`/reports/${report.id}`}
                        className="text-[13px] text-indigo-600 font-semibold hover:text-indigo-700 no-underline"
                      >
                        View →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
