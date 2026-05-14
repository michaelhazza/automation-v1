// client/src/pages/operate/components/RunTraceModal.tsx
//
// Modal that wraps a run-trace page in an iframe with ?embedded=1.
//
// The iframe sandbox prevents the embedded page from navigating the top frame
// or opening new windows except via target="_top" (which is the correct escape
// hatch for cross-run links inside embedded mode — see RunTracePage recursion
// guard). Sandbox tokens used:
//   allow-scripts       — React/JS must run inside the frame
//   allow-same-origin   — required for the API fetch (same-origin cookies/auth)
//   allow-forms         — allow form submission within the frame (future-proof)
//
// INVARIANT: This modal intentionally does NOT pass any further props to the
// iframe URL beyond `?embedded=1`. Additional context (subaccountId etc.) can
// be appended to the `runId` string by the caller before passing it in.

import Modal from '../../../components/Modal';

interface RunTraceModalProps {
  /** Run ID (or `/run-trace/<id>?extra=params`). Anything after the path is
   *  preserved; `?embedded=1` is appended (or merged) automatically. */
  runId: string;
  onClose: () => void;
}

function buildEmbeddedUrl(runId: string): string {
  // runId may be a bare ID or a full path segment like "abc123?subaccountId=xyz".
  // Build the target URL by appending ?embedded=1 (or &embedded=1 if there are
  // already query params on the provided runId).
  const basePath = `/run-trace/${runId}`;
  const separator = basePath.includes('?') ? '&' : '?';
  return `${basePath}${separator}embedded=1`;
}

export default function RunTraceModal({ runId, onClose }: RunTraceModalProps) {
  const src = buildEmbeddedUrl(runId);

  return (
    <Modal
      title="Run Trace"
      onClose={onClose}
      size="iframe"
      zIndex={1010}
      bodyPadding="none"
    >
      <iframe
        src={src}
        title="Run Trace"
        sandbox="allow-scripts allow-same-origin allow-forms"
        style={{
          width: '100%',
          height: 'calc(100vh - 120px)',
          border: 'none',
          display: 'block',
        }}
      />
    </Modal>
  );
}
