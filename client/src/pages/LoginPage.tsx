import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { setToken } from '../lib/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      setError(e.response?.data?.error ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '40px 48px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', width: 380 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700, color: '#1e293b' }}>Automation OS</h1>
        <p style={{ margin: '0 0 28px', color: '#64748b', fontSize: 14 }}>Sign in to your account</p>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              placeholder="you@example.com"
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Password</label>
              <Link to="/forgot-password" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>Forgot password?</Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              placeholder="Enter your password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', padding: '11px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: 24, padding: '14px 16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#0369a1', marginBottom: 6 }}>Test credentials</div>
          <div style={{ fontSize: 13, color: '#0c4a6e' }}>
            <div>Email: <code style={{ background: '#e0f2fe', padding: '1px 4px', borderRadius: 3 }}>admin@automation.os</code></div>
            <div style={{ marginTop: 2 }}>Password: <code style={{ background: '#e0f2fe', padding: '1px 4px', borderRadius: 3 }}>Admin123!</code></div>
          </div>
          <button
            type="button"
            onClick={() => { setEmail('admin@automation.os'); setPassword('Admin123!'); }}
            style={{ marginTop: 8, background: 'none', border: '1px solid #7dd3fc', borderRadius: 6, color: '#0284c7', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}
          >
            Fill credentials
          </button>
        </div>
      </div>
    </div>
  );
}
