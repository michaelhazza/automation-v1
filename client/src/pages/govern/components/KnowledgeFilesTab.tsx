// client/src/pages/govern/components/KnowledgeFilesTab.tsx
// Files tab for the Knowledge page.
// Spec: tasks/builds/auto-knowledge-retrieval/plan.md Chunk 5D

import { useEffect, useState } from 'react';
import { listFiles, type FilesListResponse, type FileEntry } from '../../../api/filesApi';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileRowMenu({ file: _file }: { file: FileEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-700 text-base"
        aria-label="Row actions"
      >
        ⋮
      </button>
      {open && (
        <>
          {/* Backdrop to close menu on outside click */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-8 z-50 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[180px] py-1">
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-indigo-600 font-semibold hover:bg-indigo-50"
              onClick={() => {
                // Chunk 5E implements the actual modal
                setOpen(false);
              }}
            >
              Add to Knowledge
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function KnowledgeFilesTab() {
  const [data, setData] = useState<FilesListResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [linkedFilter, setLinkedFilter] = useState<boolean | undefined>(undefined);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    setData(null);
    setError(null);
    listFiles({ linkedToKnowledge: linkedFilter })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [linkedFilter, fetchKey]);

  if (error) {
    return <ErrorState error={error} retry={() => setFetchKey((k) => k + 1)} />;
  }

  return (
    <div className="p-6">
      {/* Filter pills */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setLinkedFilter(undefined)}
          className={
            linkedFilter === undefined
              ? 'px-3 py-1 rounded-full text-xs font-medium border bg-slate-900 text-white border-slate-900'
              : 'px-3 py-1 rounded-full text-xs font-medium border border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
          }
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setLinkedFilter(true)}
          className={
            linkedFilter === true
              ? 'px-3 py-1 rounded-full text-xs font-medium border bg-slate-900 text-white border-slate-900'
              : 'px-3 py-1 rounded-full text-xs font-medium border border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
          }
        >
          Added to Documents
        </button>
      </div>

      {data === null ? (
        <div className="text-sm text-slate-500 py-8">Loading files...</div>
      ) : data.files.length === 0 ? (
        <EmptyState
          title="No files yet"
          body="Files your agents produce will appear here."
        />
      ) : (
        <table className="w-full text-left text-sm border-separate border-spacing-0 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                File
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                Agent
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                Size
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                Date added
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                Status
              </th>
              <th className="px-4 py-3 border-b border-slate-200 w-10" />
            </tr>
          </thead>
          <tbody>
            {data.files.map((file) => (
              <tr key={file.id} className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
                <td className="px-4 py-3 align-middle">
                  <div className="font-semibold text-slate-800 text-sm">{file.fileName}</div>
                  {file.mimeType && (
                    <div className="text-xs text-slate-500 mt-0.5">{file.mimeType}</div>
                  )}
                </td>
                <td className="px-4 py-3 align-middle">
                  {file.subaccountId ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                      {file.subaccountId}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Unknown</span>
                  )}
                </td>
                <td className="px-4 py-3 align-middle text-sm text-slate-600">
                  {formatFileSize(file.fileSizeBytes)}
                </td>
                <td className="px-4 py-3 align-middle text-sm text-slate-500">
                  {new Date(file.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 align-middle">
                  {file.promotedDocumentId !== null ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Added
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 align-middle">
                  <FileRowMenu file={file} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
