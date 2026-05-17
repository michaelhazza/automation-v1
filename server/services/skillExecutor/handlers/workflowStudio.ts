import type { SkillExecutionContext } from '../context.js';

// ─── Workflow Studio tool executors ──────────────────────────────────────────
// Spec: tasks/Workflows-spec.md §10.8.4 — the five tools the Workflow
// Author agent calls. All five delegate to workflowStudioService.
//
// Dynamic-imported on first call to avoid pulling the Workflow services
// into the eager skillExecutor graph (which is loaded by every agent run).

export async function executeWorkflowReadExisting(
  input: Record<string, unknown>
): Promise<unknown> {
  const slug = String(input.slug ?? '');
  if (!slug) return { success: false, error: 'slug is required' };
  const { WorkflowStudioService: workflowStudioService } = await import('../../workflowStudioService.js');
  try {
    return workflowStudioService.readExistingWorkflow(slug);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeWorkflowValidate(
  input: Record<string, unknown>
): Promise<unknown> {
  const definition = input.definition;
  if (!definition) return { success: false, error: 'definition is required' };
  const { WorkflowStudioService: workflowStudioService } = await import('../../workflowStudioService.js');
  return workflowStudioService.validateCandidate(definition);
}

export async function executeWorkflowSimulate(
  input: Record<string, unknown>
): Promise<unknown> {
  const definition = input.definition;
  if (!definition) return { success: false, error: 'definition is required' };
  const { WorkflowStudioService: workflowStudioService } = await import('../../workflowStudioService.js');
  return workflowStudioService.simulateRun(definition);
}

export async function executeWorkflowEstimateCost(
  input: Record<string, unknown>
): Promise<unknown> {
  const definition = input.definition;
  if (!definition) return { success: false, error: 'definition is required' };
  const mode = (input.mode as 'optimistic' | 'pessimistic' | undefined) ?? 'pessimistic';
  const { WorkflowStudioService: workflowStudioService } = await import('../../workflowStudioService.js');
  return workflowStudioService.estimateCost(definition, { mode });
}

export async function executeWorkflowProposeSave(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  // Definition-only API. The agent supplies the validated definition
  // object (NOT raw file contents) and the server renders the
  // .Workflow.ts file deterministically. There is no input the agent
  // can use to inject arbitrary file content — that's the whole point
  // of spec invariant 14 in the post-round-3 design.
  const sessionId = String(input.sessionId ?? '');
  const definition = input.definition;
  if (!sessionId) {
    return { success: false, error: 'sessionId is required' };
  }
  if (!definition || typeof definition !== 'object') {
    return {
      success: false,
      error:
        'definition object is required. propose_save no longer accepts fileContents — the server renders the Workflow file deterministically from the validated definition.',
    };
  }
  // Feature 3 §5.6 — high-severity gate for n8n imports.
  // If the caller passes unresolved_high_severity_count > 0, the import
  // session still has unacknowledged high-severity mapping items (disconnected
  // nodes, unconvertible code/function nodes). Block until the admin resolves
  // or explicitly dismisses each item.
  if (
    typeof input.unresolved_high_severity_count === 'number' &&
    input.unresolved_high_severity_count > 0
  ) {
    return {
      success: false,
      error: `Cannot save: ${input.unresolved_high_severity_count} high-severity item(s) from the n8n import are unresolved. Review the ⚠ rows in the mapping report, resolve or explicitly dismiss each one with the admin, then call workflow_propose_save again with unresolved_high_severity_count: 0.`,
    };
  }
  // Strict user-scope enforcement (review finding #3 from the previous
  // round). The agent run's initiating principal MUST be present on the
  // SkillExecutionContext; if it's missing (e.g. a scheduled / system
  // run that has no user identity), we refuse to write to user-owned
  // session rows.
  if (!context.userId) {
    return {
      success: false,
      error:
        'workflow_propose_save requires a user-scoped agent run. The current run has no userId on its SkillExecutionContext (likely a scheduled or system run). Studio sessions can only be modified by their owners.',
    };
  }
  const { WorkflowStudioService: workflowStudioService } = await import('../../workflowStudioService.js');
  // Validate + render in one call. This re-uses the exact same code
  // path the /render endpoint uses, so the server's view of the
  // canonical file body is consistent everywhere.
  const rendered = workflowStudioService.validateAndRender(definition);
  if (!rendered.ok) {
    return {
      success: false,
      error: 'Definition failed validation',
      validationErrors: rendered.errors,
    };
  }
  // Persist the rendered file as the session's candidate, scoped by
  // (sessionId, userId). Returns false when the session doesn't exist
  // OR isn't owned by the calling user.
  const updated = await workflowStudioService.updateCandidate(
    sessionId,
    context.userId,
    rendered.fileContents,
    'valid'
  );
  if (!updated) {
    return {
      success: false,
      error:
        'Session not found or not owned by the calling user. The agent can only update its own session.',
    };
  }
  return {
    success: true,
    message:
      'Candidate rendered and recorded. The human admin must click Save & Open PR in the Studio UI to commit this file via their GitHub identity.',
    sessionId,
    definitionHash: rendered.definitionHash,
  };
}

// ---------------------------------------------------------------------------
// Feature 3 — n8n Workflow Import (admin-callable Studio skill)
// ---------------------------------------------------------------------------

export async function executeImportN8nWorkflow(
  input: Record<string, unknown>,
): Promise<unknown> {
  const { importN8nWorkflow, renderMappingReport } = await import('../../n8nImportServicePure.js');

  const workflowJsonRaw = input.workflow_json;
  if (!workflowJsonRaw || typeof workflowJsonRaw !== 'string') {
    return { success: false, error: 'workflow_json is required and must be a string' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(workflowJsonRaw);
  } catch {
    return { success: false, error: 'workflow_json is not valid JSON. Paste the full exported n8n workflow JSON.' };
  }

  const result = importN8nWorkflow(parsed);
  if (!result.ok) {
    return { success: false, error: result.error };
  }

  const reportMarkdown = renderMappingReport(result.report);
  const highSeverityCount = result.report.filter(
    (r) => r.warning?.severity === 'high',
  ).length;

  return {
    success: true,
    workflowName: result.workflowName,
    steps: result.steps,
    report: reportMarkdown,
    credentialChecklist: result.credentialChecklist,
    highSeverityCount,
    summary: `Imported "${result.workflowName}": ${result.steps.length} steps, ${highSeverityCount} high-severity items requiring resolution before save.`,
  };
}

