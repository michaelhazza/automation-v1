import type { BriefApprovalCard as BriefApprovalCardType } from '../../../../shared/types/briefResultContract.js';
import type { ChallengeItem } from '../../../../shared/types/briefSkills.js';
import { ConfidenceBadge } from './ConfidenceBadge.js';
import { deriveIsDisabled, deriveRiskContainerStyle, deriveAffectedLabel, RISK_BADGE_STYLES } from './ApprovalCardPure.js';

interface ApprovalCardProps {
  artefact: BriefApprovalCardType;
  isSuperseded?: boolean;
  onApprove?: (artefactId: string) => void;
  onReject?: (artefactId: string) => void;
}


const SEVERITY_STYLES: Record<ChallengeItem['severity'], string> = {
  low: 'text-blue-700 bg-blue-50',
  medium: 'text-yellow-700 bg-yellow-50',
  high: 'text-red-700 bg-red-50',
};

export function ApprovalCard({ artefact, isSuperseded, onApprove, onReject }: ApprovalCardProps) {
  const isDisabled = deriveIsDisabled(artefact, isSuperseded);
  const riskStyle = deriveRiskContainerStyle(artefact.riskLevel);

  return (
    <div className={`rounded-lg border p-4 ${riskStyle} ${isSuperseded ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-gray-900">{artefact.summary}</p>
        <div className="flex items-center gap-1 shrink-0">
          {artefact.confidence !== undefined && <ConfidenceBadge confidence={artefact.confidence} />}
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${RISK_BADGE_STYLES[artefact.riskLevel] ?? RISK_BADGE_STYLES.medium}`}>
            {artefact.riskLevel} risk
          </span>
        </div>
      </div>

      {deriveAffectedLabel(artefact.affectedRecordIds.length) && (
        <p className="text-xs text-gray-500 mb-3">{deriveAffectedLabel(artefact.affectedRecordIds.length)}</p>
      )}

      {artefact.executionStatus === 'completed' && (
        <p className="text-xs text-green-700 font-medium mb-2">Action completed</p>
      )}
      {artefact.executionStatus === 'failed' && (
        <p className="text-xs text-red-700 font-medium mb-2">Action failed</p>
      )}
      {artefact.executionStatus === 'running' && (
        <p className="text-xs text-blue-700 font-medium mb-2">Running…</p>
      )}

      {artefact.challengeOutput && artefact.challengeOutput.items.length > 0 && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <p className="text-xs font-medium text-gray-500 mb-2">
            Potential concerns ({artefact.challengeOutput.overallRisk} risk)
          </p>
          <ul className="space-y-1.5">
            {artefact.challengeOutput.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${SEVERITY_STYLES[item.severity]}`}>
                  {item.severity}
                </span>
                <span className="text-gray-700">{item.concern}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isDisabled && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onApprove?.(artefact.artefactId)}
            className="flex-1 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 font-medium"
          >
            Approve
          </button>
          <button
            onClick={() => onReject?.(artefact.artefactId)}
            className="flex-1 px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded hover:bg-gray-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
