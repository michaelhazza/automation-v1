import { useState, useRef } from 'react';
import api from '../../lib/api';
import type { AnalysisJob } from './SkillAnalyzerWizard';

type Tab = 'paste' | 'upload' | 'github' | 'download';

interface Props {
  onJobCreated: (jobId: string, job: AnalysisJob) => void;
}

export default function SkillAnalyzerImportStep({ onJobCreated }: Props) {
  const [tab, setTab] = useState<Tab>('paste');
  const [pasteText, setPasteText] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const TABS: Tab[] = ['paste', 'upload', 'github', 'download'];
  const tabLabels: Record<Tab, string> = { paste: 'Paste', upload: 'Upload', github: 'GitHub URL', download: 'Download URL' };

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith('.md') || f.name.endsWith('.json') || f.name.endsWith('.zip')
    );
    setFiles((prev) => [...prev, ...dropped]);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selected]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);

    try {
      let jobId: string;
      let jobData: AnalysisJob;

      if (tab === 'paste') {
        if (pasteText.trim().length < 10) {
          setError('Paste text must be at least 10 characters.');
          return;
        }
        const res = await api.post('/api/system/skill-analyser/jobs', {
          sourceType: 'paste',
          text: pasteText,
        });
        jobId = res.data.id;
        jobData = res.data;
      } else if (tab === 'upload') {
        if (files.length === 0) {
          setError('Please select at least one file.');
          return;
        }
        const formData = new FormData();
        formData.append('sourceType', 'upload');
        for (const f of files) {
          formData.append('files', f);
        }
        const res = await api.post('/api/system/skill-analyser/jobs', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        jobId = res.data.id;
        jobData = res.data;
      } else if (tab === 'download') {
        if (!/^https?:\/\/.+/.test(downloadUrl.trim())) {
          setError('Please enter a valid HTTP or HTTPS URL.');
          return;
        }
        const res = await api.post('/api/system/skill-analyser/jobs', {
          sourceType: 'download',
          url: downloadUrl.trim(),
        });
        jobId = res.data.id;
        jobData = res.data;
      } else {
        if (!/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(githubUrl.trim())) {
          setError('Please enter a valid GitHub URL (https://github.com/{owner}/{repo}).');
          return;
        }
        const res = await api.post('/api/system/skill-analyser/jobs', {
          sourceType: 'github',
          url: githubUrl.trim(),
        });
        jobId = res.data.id;
        jobData = res.data;
      }

      onJobCreated(jobId, jobData);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to create analysis job.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    (tab === 'paste' && pasteText.trim().length >= 10) ||
    (tab === 'upload' && files.length > 0) ||
    (tab === 'github' && /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(githubUrl.trim())) ||
    (tab === 'download' && /^https?:\/\/.+/.test(downloadUrl.trim()));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-base font-semibold text-slate-800 mb-4">Import Skills</h2>

      {/* Tab selector */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-6 w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {/* Paste tab */}
      {tab === 'paste' && (
        <div>
          <p className="text-xs text-slate-500 mb-2">
            Paste one or more skill definitions. Separate multiple skills with <code>---</code> on its own line.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`---\nname: My Skill\nslug: my-skill\ndescription: Does something useful\n---\n\n## Instructions\nSteps to follow...\n\n## Tool Definition\n\`\`\`json\n{ "name": "my_skill", "description": "...", "input_schema": {} }\n\`\`\``}
            rows={16}
            className="w-full text-sm font-mono border border-slate-200 rounded-lg p-3 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700 placeholder:text-slate-300"
          />
          <p className="text-xs text-slate-400 mt-1">{pasteText.length} characters</p>
        </div>
      )}

      {/* Upload tab */}
      {tab === 'upload' && (
        <div>
          <p className="text-xs text-slate-500 mb-3">
            Upload <code>.md</code>, <code>.json</code>, or <code>.zip</code> skill files. Max 50 MB total.
          </p>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
          >
            <p className="text-sm text-slate-500">
              Drag & drop files here, or <span className="text-indigo-600 font-medium">browse</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">.md, .json, .zip accepted</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".md,.json,.zip"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>

          {files.length > 0 && (
            <div className="mt-3 space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <span className="text-slate-700 font-medium">{f.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs">{formatBytes(f.size)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* GitHub tab */}
      {tab === 'github' && (
        <div>
          <p className="text-xs text-slate-500 mb-2">
            Enter a public GitHub URL pointing to a repository or directory containing skill files.
          </p>
          <input
            type="url"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/tree/main/skills"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700 placeholder:text-slate-300"
          />
          <p className="text-xs text-slate-400 mt-1">
            Example: <code>https://github.com/anthropics/claude-skills</code>
          </p>
        </div>
      )}

      {/* Download URL tab */}
      {tab === 'download' && (
        <div>
          <p className="text-xs text-slate-500 mb-2">
            Enter a URL to a skill file (<code>.md</code>, <code>.json</code>) or a <code>.zip</code> archive.
            Supports Google Drive, Dropbox, OneDrive, Box sharing links, or any direct HTTP link.
          </p>
          <input
            type="url"
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
            placeholder="https://example.com/skills.zip"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700 placeholder:text-slate-300"
          />
          <p className="text-xs text-slate-400 mt-1">
            Sharing links from Google Drive, Dropbox, OneDrive, and Box are automatically converted to direct downloads.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Starting analysis…' : 'Analyze Skills'}
        </button>
      </div>
    </div>
  );
}
