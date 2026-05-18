// browser-vision-grounding spec §3 (framing assumptions), §8.3, §8.8, §12.5.
// V1: stub. Fails loudly — never writes status:'completed'.
// Follow-up build wires screenshot capture, vLLM HTTP call, Playwright execution,
// vision_calls.json accumulator, and the DOM-first-then-vision orchestration for
// hybrid mode (see spec §13 deferred items, "Full harness wiring").
//
// Token redaction (spec §8.3): when implementing the follow-up wiring, the
// visionEndpointToken MUST be treated as a masked secret. NEVER interpolate it
// into log lines, error messages, or vision_calls.json. The audit checklist:
//   - logger calls scrub the token before formatting
//   - failure-payload constructors omit the token field
//   - artefact JSON files omit the token field
//   - sandbox stdout / stderr never echo it

interface HarnessInput {
  decisionMode?: 'dom' | 'vision' | 'hybrid' | null;
  visionEndpointUrl?: string | null;
  visionEndpointToken?: string | null;
  visionModelId?: string | null;
}

interface HarnessOutput {
  status: 'completed' | 'failed';
  reason?: string;
}

/**
 * V1 stub: loud-failure entry point invoked by index.ts when decisionMode is
 * 'vision' or 'hybrid'. Returns status:'failed' unconditionally.
 *
 * Spec §8.3 redaction contract: the visionEndpointToken field on `input` MUST
 * NOT appear in the reason string, log lines, or any artefact produced by this
 * function (or its follow-up implementation).
 */
export async function visionDecisionLoop(input: HarnessInput): Promise<HarnessOutput> {
  const mode = input.decisionMode ?? 'dom';
  return {
    status: 'failed',
    reason:
      `visionDecisionLoop: V1 stub — the e2b SDK is not installed yet, so the ` +
      `screenshot+vLLM+Playwright loop is not wired. decisionMode=${mode}. ` +
      `Mapped to FailureReason='vision_inference_unavailable' by the IEE finalisation ` +
      `path on harness exit. See spec §13 deferred items, "Full harness wiring".`,
  };
  // Do NOT include input.visionEndpointToken in the reason string — token-redaction
  // contract (spec §8.3) applies even in the stub.
}
