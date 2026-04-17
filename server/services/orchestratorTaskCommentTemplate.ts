// ---------------------------------------------------------------------------
// Orchestrator Task Comment Template
//
// Pure function that renders the task comment the Orchestrator posts on
// the source task after a routing decision. Consistent voice so users
// learn to recognise Orchestrator posts.
//
// See docs/orchestrator-capability-routing-spec.md §8.4.
// ---------------------------------------------------------------------------

export type OrchestratorPath = 'A' | 'B' | 'C' | 'D' | 'routing_failed' | 'routing_timeout';

export interface CommentInput {
  path: OrchestratorPath;
  targetAgentName?: string | null;
  missingCapabilities?: Array<{ kind: string; slug: string }>;
  featureRequestId?: string | null;
  configAssistantRunId?: string | null;
  reason?: string;
}

export interface CommentOutput {
  title: string;
  summary: string;
  nextStep: string;
  links: Array<{ label: string; value: string }>;
  fullText: string;
}

function formatMissingList(missing: Array<{ kind: string; slug: string }> | undefined): string {
  if (!missing || missing.length === 0) return '';
  return missing.map((m) => `\`${m.kind}:${m.slug}\``).join(', ');
}

export function renderTaskComment(input: CommentInput): CommentOutput {
  const links: Array<{ label: string; value: string }> = [];

  let title: string;
  let summary: string;
  let nextStep: string;

  switch (input.path) {
    case 'A': {
      title = `[Orchestrator] Routing to ${input.targetAgentName ?? 'agent'}`;
      summary = `This agent has the capabilities your task needs and is already configured.`;
      nextStep = `The agent will pick this up from the task board shortly. No further action needed from you.`;
      break;
    }
    case 'B': {
      const missing = formatMissingList(input.missingCapabilities);
      title = `[Orchestrator] Handing off to the Configuration Assistant`;
      summary = `I can set this up for you. Handing off to the Configuration Assistant to walk you through the setup.${missing ? ` You'll need to configure: ${missing}.` : ''}`;
      nextStep = `Watch for a message from the Configuration Assistant in your agent chat.`;
      if (input.configAssistantRunId) {
        links.push({ label: 'Config Assistant run', value: input.configAssistantRunId });
      }
      break;
    }
    case 'C': {
      const missing = formatMissingList(input.missingCapabilities);
      title = `[Orchestrator] Handing off to the Configuration Assistant`;
      summary = `I can set this up for you. Handing off to the Configuration Assistant to walk you through the setup.${missing ? ` You'll need to configure: ${missing}.` : ''}`;
      nextStep = `Watch for a message from the Configuration Assistant in your agent chat.`;
      if (input.configAssistantRunId) {
        links.push({ label: 'Config Assistant run', value: input.configAssistantRunId });
      }
      // Note: the system_promotion feature request is behind-the-scenes; the user
      // does not see it in the task comment — it's internal product signal.
      break;
    }
    case 'D': {
      const missing = formatMissingList(input.missingCapabilities);
      title = `[Orchestrator] Platform does not support this request yet`;
      summary = `This request needs ${missing || 'a capability'} which the platform does not support today. I've filed a feature request with our team on your behalf.`;
      nextStep = `No further action needed right now. The Synthetos team will review the request.`;
      if (input.featureRequestId) {
        links.push({ label: 'Feature request', value: input.featureRequestId });
      }
      break;
    }
    case 'routing_failed': {
      title = `[Orchestrator] I hit an infrastructure error classifying this request`;
      summary = input.reason ?? `An unexpected error prevented me from classifying this task.`;
      nextStep = `Our team has been notified. You can leave this task here — a human will pick it up.`;
      break;
    }
    case 'routing_timeout': {
      title = `[Orchestrator] I wasn't able to classify this request`;
      summary = `I ran out of capacity trying to understand this task. This usually means the request is ambiguous or references something I couldn't map to a platform capability.`;
      nextStep = `Try rephrasing the task with more specific integration names, or contact support if this keeps happening.`;
      break;
    }
  }

  const fullText = [
    title,
    '',
    summary,
    '',
    nextStep,
    ...(links.length > 0 ? ['', ...links.map((l) => `- ${l.label}: ${l.value}`)] : []),
  ].join('\n');

  return { title, summary, nextStep, links, fullText };
}
