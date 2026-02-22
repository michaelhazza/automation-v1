import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSuccess(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '40px 48px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', width: 380 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700, color: '#1e293b' }}>Reset password</h1>
        <p style={{ margin: '0 0 28px', color: '#64748b', fontSize: 14 }}>
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {success ? (
          <div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '16px', marginBottom: 20, color: '#16a34a', fontSize: 14, lineHeight: 1.6 }}>
              If that email address is registered, you'll receive a password reset link shortly. Check your inbox (and spam folder).
            </div>
            <Link
              to="/login"
              style={{ display: 'block', textAlign: 'center', color: '#2563eb', fontSize: 14, textDecoration: 'none' }}
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 20 }}>
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
              <button
                type="submit"
                disabled={loading}
                style={{ width: '100%', padding: '11px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, marginBottom: 16 }}
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
            <Link
              to="/login"
              style={{ display: 'block', textAlign: 'center', color: '#64748b', fontSize: 14, textDecoration: 'none' }}
            >
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
