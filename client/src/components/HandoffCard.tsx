/**
 * HandoffCard.tsx — Brain Tree OS adoption P1.
 *
 * Renders the structured handoff document attached to a finished run on the
 * RunTraceViewerPage. Mirrors the shape of AgentRunHandoffV1 from the server
 * pure module — keep this in sync if the version is bumped.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P1
 */

interface HandoffShape {
  version: 1;
  accomplishments: string[];
  decisions: Array<{ decision: string; rationale: string }>;
  blockers: Array<{ blocker: string; severity: 'low' | 'medium' | 'high' }>;
  nextRecommendedAction: string | null;
  keyArtefacts: Array<{ kind: string; id: string | null; label: string }>;
  generatedAt: string;
  runStatus: string;
  durationMs: number | null;
}

const SEVERITY_PILL: Record<HandoffShape['blockers'][number]['severity'], string> = {
  low:    'bg-slate-100 text-slate-600 border-slate-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high:   'bg-red-50 text-red-700 border-red-200',
};

export default function HandoffCard({ handoff }: { handoff: HandoffShape }) {
  const isEmpty =
    handoff.accomplishments.length === 0 &&
    handoff.decisions.length === 0 &&
    handoff.blockers.length === 0 &&
    !handoff.nextRecommendedAction;

  if (isEmpty) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 rounded-xl p-5 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[14px] font-bold text-indigo-900 uppercase tracking-wider m-0">Session Handoff</h3>
        <span className="text-[11px] text-indigo-500 font-medium">v{handoff.version}</span>
      </div>

      {handoff.nextRecommendedAction && (
        <div className="bg-white/60 border border-indigo-200 rounded-lg px-3 py-2.5 mb-3">
          <div className="text-[10.5px] font-semibold text-indigo-500 uppercase tracking-wider mb-0.5">Next Recommended</div>
          <div className="text-[13.5px] font-semibold text-slate-800">{handoff.nextRecommendedAction}</div>
        </div>
      )}

      {handoff.accomplishments.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Accomplishments</div>
          <ul className="m-0 pl-5 flex flex-col gap-0.5">
            {handoff.accomplishments.map((line, i) => (
              <li key={i} className="text-[13px] text-slate-700">{line}</li>
            ))}
          </ul>
        </div>
      )}

      {handoff.decisions.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Decisions</div>
          <ul className="m-0 pl-5 flex flex-col gap-0.5">
            {handoff.decisions.map((d, i) => (
              <li key={i} className="text-[13px] text-slate-700">
                <span className="font-semibold">{d.decision}</span>
                {d.rationale && <span className="text-slate-500"> — {d.rationale}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {handoff.blockers.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Blockers</div>
          <div className="flex flex-col gap-1.5">
            {handoff.blockers.map((b, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border uppercase ${SEVERITY_PILL[b.severity]}`}>
                  {b.severity}
                </span>
                <span className="text-[13px] text-slate-700">{b.blocker}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {handoff.keyArtefacts.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Key Artefacts</div>
          <div className="flex flex-wrap gap-1.5">
            {handoff.keyArtefacts.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11.5px] bg-white/70 border border-slate-200 rounded-full px-2 py-0.5 text-slate-700">
                <span className="text-slate-400">{a.kind}:</span>
                <span className="font-medium">{a.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
