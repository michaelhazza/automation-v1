// ---------------------------------------------------------------------------
// approvalChannel — channel adapter interface and shared approval types
//
// Spec: tasks/builds/agentic-commerce/spec.md §13.3
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 9
// ---------------------------------------------------------------------------

export interface SpendApprovalPayload {
  merchant: { id: string | null; descriptor: string };
  amountMinor: number;
  currency: string;
  intent: string;
  /** Last 4 digits of the SPT card, when available. */
  sptLast4: string | null;
}

export interface ApprovalRequest {
  actionId: string;
  chargeId: string;
  organisationId: string;
  subaccountId: string | null;
  spendingBudgetId: string;
  payload: SpendApprovalPayload;
  approvers: Array<{ userId: string }>;
  expiresAt: Date;
}

export interface ApprovalResponse {
  actionId: string;
  decision: 'approved' | 'denied';
  responderId: string;
  respondedAt: Date;
  channelType: string;
}

export interface ApprovalResolution {
  actionId: string;
  resolvedBy: { userId: string; channelType: string; respondedAt: Date };
  decision: 'approved' | 'denied';
  resolutionMessage: string;
}

export interface ApprovalChannel {
  channelType: string;
  sendApprovalRequest(req: ApprovalRequest): Promise<void>;
  receiveResponse(raw: unknown): ApprovalResponse | null;
  sendResolutionNotice(resolution: ApprovalResolution): Promise<void>;
}
