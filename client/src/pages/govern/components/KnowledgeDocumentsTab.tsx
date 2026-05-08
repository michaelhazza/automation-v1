// client/src/pages/govern/components/KnowledgeDocumentsTab.tsx
// Documents tab for the Knowledge page.
// Spec: tasks/builds/auto-knowledge-retrieval/plan.md Chunk 5D

import { useEffect, useState } from 'react';
import api from '../../../lib/api';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';

type DocumentMode = 'auto' | 'always_available' | 'reference_only';
type DocumentSource = 'manual' | 'external' | 'google_drive' | 'from_file';

interface ReferenceDocumentRow {
  id: string;
  name: string;
  mode: DocumentMode;
  sourceType: DocumentSource;
  createdAt: string;
}

const MODE_CHIP: Record<DocumentMode, { label: string; className: string }> = {
  auto: {
    label: 'Auto',
    className: 'bg-slate-100 text-slate-700',
  },
  always_available: {
    label: 'Always on',
    className: 'bg-green-50 text-green-700',
  },
  reference_only: {
    label: 'Reference only',
    className: 'bg-blue-50 text-blue-700',
  },
};

const SOURCE_LABEL: Record<DocumentSource, string> = {
  from_file: 'From file',
  manual: 'Manual',
  external: 'External',
  google_drive: 'Google Drive',
};

function ModeChip({ mode }: { mode: DocumentMode }) {
  const chip = MODE_CHIP[mode] ?? MODE_CHIP.auto;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${chip.className}`}>
      {chip.label}
    </span>
  );
}

export function KnowledgeDocumentsTab() {
  const [docs, setDocs] = useState<ReferenceDocumentRow[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    setDocs(null);
    setError(null);
    api
      .get<ReferenceDocumentRow[]>('/api/reference-documents')
      .then((r) => setDocs(r.data))
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [fetchKey]);

  // TODO(Chunk 7A): render always-available capacity banner here once
  // the /api/reference-documents/capacity endpoint exists.

  if (error) {
    return <ErrorState error={error} retry={() => setFetchKey((k) => k + 1)} />;
  }

  if (docs === null) {
    return <div className="p-6 text-sm text-slate-500">Loading...</div>;
  }

  if (docs.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No documents yet"
          body="Upload a document or promote an agent file to add it here."
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <table className="w-full text-left text-sm border-separate border-spacing-0 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-slate-50">
            <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
              Name
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
              Mode
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
              Source
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
              Date added
            </th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id} className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
              <td className="px-4 py-3 align-middle font-semibold text-slate-800">
                {doc.name}
              </td>
              <td className="px-4 py-3 align-middle">
                <ModeChip mode={doc.mode} />
              </td>
              <td className="px-4 py-3 align-middle text-sm text-slate-600">
                {SOURCE_LABEL[doc.sourceType] ?? doc.sourceType}
              </td>
              <td className="px-4 py-3 align-middle text-sm text-slate-500">
                {new Date(doc.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
