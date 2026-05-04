import { useEffect, useState, useCallback } from 'react';
import api from '../../lib/api';
import { DiffRenderer } from './DiffRenderer';

interface FileReaderProps {
  taskId: string;
  fileId: string;
  fileName: string;
  producerAgentId?: string;
  updatedAt?: string;
  lastEditRequest?: string;
}

interface VersionContent {
  doc: {
    id: string;
    name: string;
    currentVersion: number;
  };
  version: {
    version: number;
    content: string;
  } | null;
}

export function FileReader({ taskId, fileId, fileName, producerAgentId, updatedAt, lastEditRequest }: FileReaderProps) {
  const [data, setData] = useState<VersionContent | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const fetchFile = useCallback((version?: number) => {
    setLoading(true);
    const url = version !== undefined
      ? `/api/tasks/${taskId}/files/${fileId}?version=${version}`
      : `/api/tasks/${taskId}/files/${fileId}`;

    api.get<VersionContent>(url)
      .then(({ data: d }) => {
        setData(d);
        setContent(d.version?.content ?? '');
        if (selectedVersion === null) {
          setSelectedVersion(d.doc.currentVersion);
        }
      })
      .catch((err) => {
        console.error('[FileReader] Failed to fetch file', err);
      })
      .finally(() => setLoading(false));
  }, [taskId, fileId, selectedVersion]);

  useEffect(() => {
    fetchFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, fileId, refreshToken]);

  const handleVersionChange = (v: number) => {
    setSelectedVersion(v);
    setShowDiff(false);
    fetchFile(v);
  };

  const handleReverted = () => {
    // Refresh to pick up the new version.
    setSelectedVersion(null);
    setShowDiff(false);
    setRefreshToken(t => t + 1);
  };

  const currentVersion = data?.doc.currentVersion ?? 1;
  const displayVersion = selectedVersion ?? currentVersion;

  const downloadFile = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openInNewWindow = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  if (loading && !data) {
    return <div className="p-4 text-[12px] text-slate-400">Loading...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-slate-800 truncate">{fileName}</span>
          <span className="ml-2 text-[11px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">v{displayVersion}</span>
          {currentVersion > 1 && (
            <select
              value={displayVersion}
              onChange={(e) => handleVersionChange(Number(e.target.value))}
              className="ml-2 text-[11px] border border-slate-200 rounded px-1 py-0.5 text-slate-600"
            >
              {Array.from({ length: currentVersion }, (_, i) => i + 1).map((v) => (
                <option key={v} value={v}>
                  {v === currentVersion ? `v${v} (current)` : `v${v}`}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentVersion > 1 && displayVersion === currentVersion && (
            <button
              onClick={() => setShowDiff(d => !d)}
              className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                showDiff
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {showDiff ? 'Hide changes' : 'Show changes'}
            </button>
          )}
          <button
            onClick={downloadFile}
            className="text-[11px] text-slate-600 border border-slate-200 rounded px-2 py-1 hover:border-slate-400 transition-colors"
          >
            Download
          </button>
          <button
            onClick={openInNewWindow}
            className="text-[11px] text-slate-600 border border-slate-200 rounded px-2 py-1 hover:border-slate-400 transition-colors"
          >
            Open
          </button>
        </div>
      </div>

      {/* Content */}
      {showDiff && currentVersion > 1 && displayVersion === currentVersion ? (
        <DiffRenderer
          taskId={taskId}
          fileId={fileId}
          fromVersion={currentVersion - 1}
          producerAgentId={producerAgentId}
          updatedAt={updatedAt}
          lastEditRequest={lastEditRequest}
          onReverted={handleReverted}
        />
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-[12px] text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">
            {content || <span className="text-slate-400">Empty document</span>}
          </pre>
        </div>
      )}
    </div>
  );
}
