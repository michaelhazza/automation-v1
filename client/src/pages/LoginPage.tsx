import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { setToken } from '../lib/auth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/api/auth/login', { email, password });
      setToken(data.token);
      window.location.href = '/';
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex font-sans">
      {/* Left panel – brand */}
      <div className="w-[440px] shrink-0 flex flex-col p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
        {/* Decorative blobs */}
        <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-20 -left-10 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)' }} />

        {/* Brand */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', boxShadow: '0 4px 16px rgba(99,102,241,0.5)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <span className="text-xl font-bold text-slate-100 tracking-tight">Automation OS</span>
          </div>

          <div className="mb-8">
            <h1 className="text-[34px] font-extrabold text-slate-100 tracking-tight leading-tight mb-4">
              Your automation<br />command centre
            </h1>
            <p className="text-[15px] text-slate-400 leading-relaxed">
              Execute workflows, track results, and govern your automation operations — all in one place.
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            {[
              { icon: '⚡', text: 'Engine-agnostic workflow execution' },
              { icon: '🛡️', text: 'Role-based access control & audit trails' },
              { icon: '📊', text: 'Real-time execution monitoring' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-base">{icon}</span>
                <span className="text-[13px] text-slate-300">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto relative z-10">
          <p className="text-xs text-slate-600">© 2025 Automation OS · Built for automation agencies</p>
        </div>
      </div>

      {/* Right panel – form */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-8 py-10">
        <div className="w-full max-w-[400px] animate-[fadeIn_0.25s_ease-out_both]">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">Welcome back</h2>
            <p className="text-sm text-slate-500">Sign in to your account to continue</p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 animate-[fadeIn_0.15s_ease-out]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-red-600 text-[13.5px]">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                autoComplete="email"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[13px] font-semibold text-slate-700">Password</label>
                <Link to="/forgot-password" className="text-[12.5px] text-indigo-600 font-medium hover:text-indigo-700">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full px-3.5 py-2.5 pr-11 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  {showPw ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-[15px] font-semibold rounded-lg transition-colors"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </>
              ) : 'Sign in'}
            </button>
          </form>

          {/* Test credentials */}
          <div className="mt-7 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-[12.5px] font-bold text-indigo-700">Test Credentials</span>
            </div>
            <div className="text-[12.5px] text-slate-500 mb-2.5 space-y-1 leading-relaxed">
              <div><strong className="text-slate-700">System Admin:</strong> <code className="bg-slate-100 px-1 py-0.5 rounded text-[11.5px]">admin@automation.os</code></div>
              <div><strong className="text-slate-700">Org Admin:</strong> <code className="bg-slate-100 px-1 py-0.5 rounded text-[11.5px]">michael@breakoutsolutions.com</code></div>
            </div>
            <div className="flex gap-2">
              {[
                { label: 'System Admin', email: 'admin@automation.os', pw: 'Admin123!' },
                { label: 'Org Admin', email: 'michael@breakoutsolutions.com', pw: 'Zu5QzB5vG8!2' },
              ].map(({ label, email: e, pw }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setEmail(e); setPassword(pw); }}
                  className="flex-1 py-1.5 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-semibold transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
