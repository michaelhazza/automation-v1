/**
 * ConfigDocumentUploadPage — Configuration Document upload + gap renderer
 *
 * Drag-and-drop uploader. After the server parses the file, surfaces status +
 * gap list. Low-confidence or missing required fields link back to the
 * onboarding conversation to complete.
 *
 * Spec: docs/memory-and-briefings-spec.md §9 (S21)
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';

interface UploadResponse {
  id: string;
  outcome: 'auto_apply' | 'gaps' | 'rejected';
  autoApplyCount: number;
  gapCount: number;
  rejectionReason?: string;
}

interface Gap {
  fieldId: string;
  answer: unknown;
  confidence: number;
  invalid?: boolean;
  invalidReason?: string;
}

export default function ConfigDocumentUploadPage() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (!subaccountId) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<UploadResponse>(
        `/api/subaccounts/${subaccountId}/config-documents/upload`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      setResult(res.data);

      if (res.data.outcome === 'gaps') {
        const gapsRes = await api.get<{ gaps: Gap[] }>(
          `/api/subaccounts/${subaccountId}/config-documents/${res.data.id}/gaps`,
        );
        setGaps(gapsRes.data.gaps ?? []);
      } else {
        setGaps([]);
      }
    } catch {
      setError('Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-slate-800 mb-2">Configuration Document Upload</h1>
      <p className="text-sm text-slate-600 mb-4">
        Drop a completed Configuration Document (DOCX, PDF, or Markdown). The system parses it and
        either auto-applies or asks for any missing details.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
        }}
        className={`border-2 border-dashed rounded-lg p-8 text-center ${
          dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'
        }`}
      >
        <p className="text-sm text-slate-600 mb-2">
          Drag a file here, or click to select.
        </p>
        <input
          type="file"
          onChange={(e) => {
            if (e.target.files?.[0]) upload(e.target.files[0]);
          }}
          accept=".docx,.pdf,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
          className="text-sm"
          disabled={uploading}
        />
      </div>

      {uploading && <div className="mt-3 text-sm text-slate-500">Parsing…</div>}
      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      {result && (
        <div className="mt-5 border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Outcome
          </p>
          <h2 className="text-base font-semibold text-slate-800 mb-2">
            {result.outcome === 'auto_apply' && 'Auto-applied — ready to finalise.'}
            {result.outcome === 'gaps' && `${result.gapCount} follow-up question(s) needed.`}
            {result.outcome === 'rejected' && 'Could not parse this document.'}
          </h2>
          <p className="text-sm text-slate-600">
            {result.rejectionReason ??
              (result.outcome === 'auto_apply'
                ? `${result.autoApplyCount} fields auto-applied.`
                : result.outcome === 'gaps'
                  ? 'Complete the missing answers in the onboarding conversation.'
                  : '')}
          </p>

          {result.outcome === 'gaps' && gaps.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Missing / low-confidence
              </p>
              <ul className="text-sm text-slate-700 list-disc list-inside">
                {gaps.map((g) => (
                  <li key={g.fieldId}>
                    <code className="text-xs bg-slate-100 px-1">{g.fieldId}</code>
                    {g.invalid && g.invalidReason && (
                      <span className="text-red-600 ml-1">— {g.invalidReason}</span>
                    )}
                  </li>
                ))}
              </ul>
              <Link
                to={`/admin/subaccounts/${subaccountId}/onboarding`}
                className="text-sm text-indigo-600 hover:underline mt-2 inline-block"
              >
                Complete in onboarding →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
