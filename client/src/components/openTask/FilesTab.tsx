import { useState } from 'react';
import type { FileProjection } from '../../../../shared/types/taskProjection';
import { classifyFile, filterFiles, sortFiles } from './filesTabPure';
import type { FileGroup, SortOrder } from './filesTabPure';
import { FileReader } from './FileReader';

interface FilesTabProps {
  taskId: string;
  files: FileProjection[];
}

export function FilesTab({ taskId, files }: FilesTabProps) {
  const [activeGroup, setActiveGroup] = useState<FileGroup>('outputs');
  const [latestOnly, setLatestOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const visibleFiles = sortFiles(
    filterFiles(files, activeGroup, latestOnly, search),
    sortOrder,
  );

  const selectedFile = selectedFileId
    ? files.find(f => f.fileId === selectedFileId) ?? null
    : null;

  const groupCounts: Record<FileGroup, number> = {
    outputs: files.filter(f => classifyFile(f) === 'outputs').length,
    references: files.filter(f => classifyFile(f) === 'references').length,
    versions: files.filter(f => classifyFile(f) === 'versions').length,
  };

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[13px] text-slate-400">
        Files will appear here once the agent produces output.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Group tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-2 border-b border-slate-100">
        {(['outputs', 'references', 'versions'] as FileGroup[]).map((g) => (
          <button
            key={g}
            onClick={() => { setActiveGroup(g); setSelectedFileId(null); }}
            className={`px-3 py-1 text-[12px] rounded-full border transition-colors capitalize ${
              activeGroup === g
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            {g} ({groupCounts[g]})
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-100">
        <input
          type="text"
          placeholder="Search files..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-[12px] border border-slate-200 rounded px-2 py-1 outline-none focus:border-indigo-400"
        />
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="text-[12px] border border-slate-200 rounded px-2 py-1 text-slate-600"
        >
          <option value="recent">Recent first</option>
          <option value="oldest">Oldest first</option>
          <option value="type">Type</option>
          <option value="author">Author</option>
        </select>
        {activeGroup === 'versions' && (
          <label className="flex items-center gap-1 text-[12px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={latestOnly}
              onChange={(e) => setLatestOnly(e.target.checked)}
              className="accent-indigo-600"
            />
            Latest only
          </label>
        )}
      </div>

      {/* Thumbnail strip */}
      <div className="px-4 py-2 border-b border-slate-100 overflow-x-auto">
        {visibleFiles.length === 0 ? (
          <p className="text-[12px] text-slate-400 py-1">No files in this group.</p>
        ) : (
          <div className="flex gap-2">
            {visibleFiles.map((f) => {
              const isSelected = selectedFileId === f.fileId;
              return (
                <button
                  key={f.fileId}
                  onClick={() => setSelectedFileId(isSelected ? null : f.fileId)}
                  className={`flex flex-col items-center p-2 rounded border transition-colors min-w-[72px] max-w-[88px] ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-slate-200 hover:border-indigo-300 bg-white'
                  }`}
                >
                  <span className="text-2xl">📄</span>
                  <span className="text-[10px] text-slate-700 truncate w-full text-center mt-1" title={f.fileId}>
                    {f.fileId.length > 12 ? f.fileId.slice(0, 10) + '...' : f.fileId}
                  </span>
                  <span className="text-[9px] text-slate-400">v{f.currentVersion}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Reader pane */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {selectedFile ? (
          <FileReader
            taskId={taskId}
            fileId={selectedFile.fileId}
            fileName={selectedFile.fileId}
            producerAgentId={selectedFile.producerAgentId}
            updatedAt={selectedFile.updatedAt}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[12px] text-slate-400">
            Select a file to view its contents.
          </div>
        )}
      </div>
    </div>
  );
}
