import type { BriefErrorResult } from '../../../../shared/types/briefResultContract.js';

interface ErrorArtefactCardProps {
  artefact: BriefErrorResult;
}

export function ErrorArtefactCard({ artefact }: ErrorArtefactCardProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <span className="text-red-500 mt-0.5">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-800">{artefact.message}</p>
          <p className="text-xs text-red-500 mt-0.5 font-mono">{artefact.errorCode}</p>
          {artefact.retryable && (
            <p className="text-xs text-red-600 mt-1">You can try again.</p>
          )}
        </div>
      </div>
    </div>
  );
}
