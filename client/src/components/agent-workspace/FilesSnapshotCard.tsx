export interface FileSnapshotEntry {
  id: string;
  name: string;
  mimeType: string | null;
  versionId: string | null;
  producingRunId: string | null;
  producingEventId: string | null;
  createdAt: string;
}

interface Props {
  files: FileSnapshotEntry[];
  agentId: string;
}

function buildFilesUrl(agentId: string, entry: FileSnapshotEntry): string {
  const params = new URLSearchParams({ tab: 'files', agentId, fileId: entry.id, versionId: entry.versionId ?? '' });
  if (entry.producingRunId) params.set('runId', entry.producingRunId);
  if (entry.producingEventId) params.set('eventId', entry.producingEventId);
  return `/govern/knowledge?${params.toString()}`;
}

export default function FilesSnapshotCard({ files, agentId }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">Files</h4>
      {files.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-4">No files produced yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {files.map(entry => (
            <a
              key={entry.id}
              href={buildFilesUrl(agentId, entry)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs text-slate-700"
            >
              <span className="truncate max-w-[120px]">{entry.name}</span>
              {entry.mimeType && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 shrink-0">
                  {entry.mimeType}
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
