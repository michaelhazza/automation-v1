// ---------------------------------------------------------------------------
// invokeAutomationStepServicePure — pure helpers for invoke_automation dispatch
//
// No DB, no I/O. All functions are deterministic and side-effect-free.
// W1-43: assertSingleWebhookComposition (pre-launch-phase-2 chunk 6).
// ---------------------------------------------------------------------------

export interface DispatchWebhookPlan {
  webhookPath: string | null;
}

/**
 * W1-43: Asserts that an automation dispatch plan has exactly one non-empty
 * webhook path. Returns { ok: true } when valid; returns { ok: false, reason }
 * when violated. Mirrors the logic of the private assertSingleWebhook function
 * in invokeAutomationStepService.ts as a testable pure extraction.
 */
export function assertSingleWebhookComposition(
  dispatch: DispatchWebhookPlan,
): { ok: true } | { ok: false; reason: string } {
  const hasWebhook = dispatch.webhookPath != null && dispatch.webhookPath !== '';
  if (!hasWebhook) return { ok: false, reason: 'no_webhooks' };
  return { ok: true };
}
