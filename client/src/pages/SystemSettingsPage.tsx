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

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold text-slate-800 m-0">System Settings</h1>
        <p className="text-slate-500 mt-2 mb-0">Platform-wide configuration for all organisations</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5 text-red-600 text-[14px]">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-5 text-green-700 text-[14px]">
          {success}
        </div>
      )}

      {/* File Upload Settings */}
      <div className="bg-white rounded-xl border border-slate-200 mb-6">
        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-[16px] font-semibold text-slate-800 m-0">File Uploads</h2>
          <p className="text-slate-500 text-[13px] mt-1 mb-0">
            Controls the maximum size of files users can attach when running tasks. Files are stored in Cloudflare R2.
          </p>
        </div>
        <div className="p-6">
          <div className="max-w-[400px]">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
              Maximum upload size per file (MB)
            </label>
            <div className="flex items-center gap-3 mb-2">
              <input
                type="number"
                min={1}
                max={500}
                value={maxUploadSizeMb}
                onChange={(e) => setMaxUploadSizeMb(parseInt(e.target.value, 10) || 1)}
                className="w-[120px] px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-[13px] text-slate-500">MB</span>
            </div>
            <div className="text-[12px] text-slate-400 leading-relaxed">
              <strong className="text-slate-500">Recommended: 200 MB.</strong> This covers most audio files (MP3, WAV),
              documents (PDF, DOCX, XLSX), images, and short video clips. Increase to 500 MB if users
              regularly upload longer videos. The absolute server ceiling is 500 MB regardless of this value.
            </div>

            <div className="flex gap-2 mt-4 flex-wrap">
              {[10, 50, 100, 200, 500].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setMaxUploadSizeMb(preset)}
                  className={`px-3 py-1 text-[12px] rounded-md border cursor-pointer transition-colors ${maxUploadSizeMb === preset ? 'bg-indigo-600 border-indigo-600 text-white font-semibold' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'}`}
                >
                  {preset} MB
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Accepted file types info */}
      <div className="bg-white rounded-xl border border-slate-200 mb-8">
        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-[16px] font-semibold text-slate-800 m-0">Accepted File Types</h2>
          <p className="text-slate-500 text-[13px] mt-1 mb-0">
            All common file types are accepted. The system does not restrict by type.
          </p>
        </div>
        <div className="px-6 py-5">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {[
              { label: 'Documents', types: 'PDF, DOCX, XLSX, PPTX, TXT, CSV' },
              { label: 'Audio', types: 'MP3, WAV, M4A, FLAC, AAC, OGG' },
              { label: 'Video', types: 'MP4, MOV, AVI, MKV, WEBM' },
              { label: 'Images', types: 'JPG, PNG, GIF, WEBP, SVG, TIFF' },
              { label: 'Archives', types: 'ZIP, TAR, GZ, 7Z' },
              { label: 'Other', types: 'Any other file type' },
            ].map(({ label, types }) => (
              <div key={label} className="bg-slate-50 rounded-lg px-3.5 py-3">
                <div className="text-[13px] font-semibold text-slate-700 mb-1">{label}</div>
                <div className="text-[12px] text-slate-500">{types}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className={`px-7 py-2.5 text-white text-[14px] font-semibold border-0 rounded-lg transition-colors ${saving ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
      >
        {saving ? 'Saving...' : 'Save settings'}
      </button>
    </>
  );
}
