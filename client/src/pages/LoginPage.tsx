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
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
    }}>
      {/* Left panel – brand */}
      <div style={{
        width: 440,
        flexShrink: 0,
        background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '48px 52px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative circles */}
        <div style={{
          position: 'absolute', top: -60, right: -60,
          width: 280, height: 280, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -80, left: -40,
          width: 320, height: 320, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Brand mark */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 64 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(99,102,241,0.5)',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
              Automation OS
            </span>
          </div>

          <div style={{ marginBottom: 32 }}>
            <h1 style={{
              margin: '0 0 16px',
              fontSize: 34,
              fontWeight: 800,
              color: '#f1f5f9',
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
            }}>
              Your automation<br />command centre
            </h1>
            <p style={{ margin: 0, fontSize: 15, color: '#94a3b8', lineHeight: 1.6 }}>
              Execute workflows, track results, and govern your automation operations — all in one place.
            </p>
          </div>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { icon: '⚡', text: 'Engine-agnostic workflow execution' },
              { icon: '🛡️', text: 'Role-based access control & audit trails' },
              { icon: '📊', text: 'Real-time execution monitoring' },
            ].map(({ icon, text }) => (
              <div key={text} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10,
              }}>
                <span style={{ fontSize: 16 }}>{icon}</span>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom text */}
        <div style={{ marginTop: 'auto', position: 'relative', zIndex: 1 }}>
          <p style={{ margin: 0, fontSize: 12, color: '#334155' }}>
            © 2025 Automation OS · Built for automation agencies
          </p>
        </div>
      </div>

      {/* Right panel – form */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        padding: '40px 32px',
      }}>
        <div style={{ width: '100%', maxWidth: 400, animation: 'fadeIn 0.25s ease-out both' }}>
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>
              Welcome back
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>
              Sign in to your account to continue
            </p>
          </div>

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 10, padding: '12px 16px', marginBottom: 20,
              display: 'flex', alignItems: 'flex-start', gap: 10,
              animation: 'fadeIn 0.15s ease-out',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span style={{ color: '#dc2626', fontSize: 13.5 }}>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="login-input"
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Password</label>
                <Link to="/forgot-password" style={{ fontSize: 12.5, color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="login-input"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    color: '#94a3b8', display: 'flex', alignItems: 'center',
                  }}
                  tabIndex={-1}
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
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: 15 }}
            >
              {loading ? (
                <>
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Test credentials card */}
          <div style={{
            marginTop: 28,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '16px 18px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4f46e5' }}>Test Credentials</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 10, lineHeight: 1.6 }}>
              <div><strong style={{ color: '#374151' }}>System Admin:</strong> <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: 11.5 }}>admin@automation.os</code></div>
              <div style={{ marginTop: 4 }}><strong style={{ color: '#374151' }}>Org Admin:</strong> <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: 11.5 }}>michael@breakoutsolutions.com</code></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => { setEmail('admin@automation.os'); setPassword('Admin123!'); }}
                style={{
                  flex: 1, padding: '7px 10px',
                  background: '#f5f3ff', color: '#6366f1',
                  border: '1px solid #c7d2fe', borderRadius: 7,
                  fontSize: 12, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
                  transition: 'background 0.15s',
                }}
              >
                System Admin
              </button>
              <button
                type="button"
                onClick={() => { setEmail('michael@breakoutsolutions.com'); setPassword('Zu5QzB5vG8!2'); }}
                style={{
                  flex: 1, padding: '7px 10px',
                  background: '#f5f3ff', color: '#6366f1',
                  border: '1px solid #c7d2fe', borderRadius: 7,
                  fontSize: 12, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
                  transition: 'background 0.15s',
                }}
              >
                Org Admin
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
