import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';

const SCOPES = [
  'View your sub-accounts (locations)',
  'Read contact and lead data',
  'Read deal and pipeline data',
  'Read conversation activity',
  'Read payment and revenue data',
  'Read business metadata (names, timezones)',
];

export default function GhlOAuthInterstitialPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/ghl/oauth-url')
      .then(({ data }) => setOauthUrl(data.url))
      .catch(() => { /* will show connect button in disabled state */ })
      .finally(() => setLoading(false));
  }, []);

  const handleConnect = () => {
    if (!oauthUrl) return;
    toast.loading('Redirecting to Go High Level...');
    window.location.href = oauthUrl;
  };

  const handleSkip = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12 font-sans">
      <div className="w-full max-w-lg animate-[fadeIn_0.25s_ease-out_both]">

        {/* OAuth failure banner */}
        {error === 'oauth_denied' && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4 mb-6">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <div>
              <p className="text-[14px] font-semibold text-red-700 mb-0.5">Connection wasn't completed</p>
              <p className="text-[13px] text-red-600">This might happen if you clicked Deny on the previous screen, or if the connection timed out.</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 border-b border-slate-100">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center shadow-md">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </div>
              <div>
                <h1 className="text-[20px] font-bold text-slate-900 leading-tight">Connect your agency in read-only mode</h1>
              </div>
            </div>
            <p className="text-[14px] text-slate-500 leading-relaxed">
              ClientPulse will <strong>never modify your Go High Level data</strong>. We only read the information below to generate your reports.
            </p>
          </div>

          {/* Scope list */}
          <div className="px-8 py-5">
            <p className="text-[12px] font-bold text-slate-400 uppercase tracking-widest mb-3">What we access</p>
            <ul className="space-y-2.5">
              {SCOPES.map((scope) => (
                <li key={scope} className="flex items-center gap-3 text-[13.5px] text-slate-700">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </span>
                  {scope}
                </li>
              ))}
            </ul>
          </div>

          {/* Security badge */}
          <div className="mx-8 mb-6 flex items-center gap-2.5 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span className="text-[12.5px] text-slate-600 font-medium">256-bit encrypted. SOC 2 pending.</span>
          </div>

          {/* CTA */}
          <div className="px-8 pb-8 flex flex-col gap-3">
            <button
              onClick={handleConnect}
              disabled={!oauthUrl}
              className="w-full flex items-center justify-center gap-2.5 px-5 py-3.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white text-[15px] font-semibold rounded-xl transition-colors shadow-sm"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              {error === 'oauth_denied' ? 'Try again →' : 'Connect Go High Level →'}
            </button>

            {error === 'oauth_denied' && (
              <a
                href="mailto:support@synthetos.ai"
                className="w-full flex items-center justify-center gap-2 px-5 py-3 border border-slate-200 rounded-xl text-[14px] text-slate-600 font-medium hover:bg-slate-50 transition-colors no-underline"
              >
                Need help?
              </a>
            )}

            <button
              onClick={handleSkip}
              className="w-full text-center text-[13.5px] text-slate-400 hover:text-slate-600 transition-colors bg-transparent border-0 cursor-pointer py-1"
            >
              I'll do this later →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
