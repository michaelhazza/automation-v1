import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

export default function SystemSettingsPage({ user }: { user: User }) {
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState<number>(200);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get('/api/system/settings')
      .then(({ data }) => {
        setMaxUploadSizeMb(parseInt(data.max_upload_size_mb, 10) || 200);
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError('');
    setSuccess('');
    if (!Number.isInteger(maxUploadSizeMb) || maxUploadSizeMb < 1 || maxUploadSizeMb > 500) {
      setError('Max upload size must be between 1 and 500 MB.');
      return;
    }
    setSaving(true);
    try {
      await api.patch('/api/system/settings', { max_upload_size_mb: String(maxUploadSizeMb) });
      setSuccess('Settings saved.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>System Settings</h1>
        <p style={{ color: '#64748b', margin: '8px 0 0' }}>Platform-wide configuration for all organisations</p>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#16a34a', fontSize: 14 }}>
          {success}
        </div>
      )}

      {/* File Upload Settings */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 24 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: 0 }}>File Uploads</h2>
          <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>
            Controls the maximum size of files users can attach when running tasks. Files are stored in Cloudflare R2.
          </p>
        </div>
        <div style={{ padding: '24px' }}>
          <div style={{ maxWidth: 400 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
              Maximum upload size per file (MB)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <input
                type="number"
                min={1}
                max={500}
                value={maxUploadSizeMb}
                onChange={(e) => setMaxUploadSizeMb(parseInt(e.target.value, 10) || 1)}
                style={{ width: 120, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              />
              <span style={{ fontSize: 13, color: '#64748b' }}>MB</span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
              <strong style={{ color: '#64748b' }}>Recommended: 200 MB.</strong> This covers most audio files (MP3, WAV),
              documents (PDF, DOCX, XLSX), images, and short video clips. Increase to 500 MB if users
              regularly upload longer videos. The absolute server ceiling is 500 MB regardless of this value.
            </div>

            {/* Quick-pick presets */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {[10, 50, 100, 200, 500].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setMaxUploadSizeMb(preset)}
                  style={{
                    padding: '4px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 6,
                    border: '1px solid #d1d5db',
                    background: maxUploadSizeMb === preset ? '#2563eb' : '#f8fafc',
                    color: maxUploadSizeMb === preset ? '#fff' : '#374151',
                    fontWeight: maxUploadSizeMb === preset ? 600 : 400,
                  }}
                >
                  {preset} MB
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Accepted file types info */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 32 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: 0 }}>Accepted File Types</h2>
          <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>
            All common file types are accepted. The system does not restrict by type.
          </p>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {[
              { label: 'Documents', types: 'PDF, DOCX, XLSX, PPTX, TXT, CSV' },
              { label: 'Audio', types: 'MP3, WAV, M4A, FLAC, AAC, OGG' },
              { label: 'Video', types: 'MP4, MOV, AVI, MKV, WEBM' },
              { label: 'Images', types: 'JPG, PNG, GIF, WEBP, SVG, TIFF' },
              { label: 'Archives', types: 'ZIP, TAR, GZ, 7Z' },
              { label: 'Other', types: 'Any other file type' },
            ].map(({ label, types }) => (
              <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{types}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{ padding: '10px 28px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
      >
        {saving ? 'Saving...' : 'Save settings'}
      </button>
    </>
  );
}
