interface Props {
  actionLabel: string;
  riskTier: number | null | undefined;
  requiresApproval: boolean;
  reason: string | null | undefined;
}

/**
 * Two-line risk context header for review queue cards and approval surfaces.
 * Line 1: "Action: {actionLabel} (Tier {N}, requires approval per policy)"
 * Line 2: "Context: {reason}" — only rendered when reason is present.
 */
export default function ApprovalRiskContext({ actionLabel, riskTier, requiresApproval, reason }: Props) {
  const tierPart = riskTier != null ? `, Tier ${riskTier}` : '';
  const policyPart = requiresApproval ? ', requires approval per policy' : '';

  return (
    <div className="mb-2 text-[12px] text-slate-500 leading-relaxed">
      <p className="m-0">
        <span className="font-medium text-slate-700">Action:</span>{' '}
        {actionLabel}{tierPart}{policyPart}
      </p>
      {reason && (
        <p className="m-0 mt-0.5">
          <span className="font-medium text-slate-700">Context:</span>{' '}
          {reason}
        </p>
      )}
    </div>
  );
}
