/**
 * topicRegistry.ts — topic taxonomy and keyword rules for P4.1.
 *
 * Sprint 5 P4.1: topics-to-actions deterministic filter. Each topic has
 * a set of keyword patterns that match against user messages. The
 * classifier uses these to narrow the agent's tool set before the LLM
 * reasons.
 *
 * Start with keyword rules (cheapest, deterministic). Switch to flash
 * model if telemetry shows rules misclassify.
 */

export interface TopicRule {
  topic: string;
  description: string;
  /** Keyword patterns (case-insensitive). Any match triggers the topic. */
  keywords: RegExp[];
}

export const TOPIC_REGISTRY: TopicRule[] = [
  {
    topic: 'email',
    description: 'Email-related actions',
    keywords: [/\bemail\b/i, /\binbox\b/i, /\bsend.*mail\b/i, /\bdraft\b/i, /\breply\b/i],
  },
  {
    topic: 'calendar',
    description: 'Calendar and scheduling',
    keywords: [/\bcalendar\b/i, /\bschedul\b/i, /\bmeeting\b/i, /\bappointment\b/i],
  },
  {
    topic: 'dev',
    description: 'Software development actions',
    keywords: [/\bcode\b/i, /\bpatch\b/i, /\bbug\b/i, /\bPR\b/, /\bpull request\b/i, /\bdeploy\b/i, /\bbuild\b/i, /\breview code\b/i],
  },
  {
    topic: 'reporting',
    description: 'Reports, analytics, and metrics',
    keywords: [/\breport\b/i, /\bmetric\b/i, /\banalyti\b/i, /\bdashboard\b/i, /\bhealth\b/i, /\bchurn\b/i, /\bportfolio\b/i],
  },
  {
    topic: 'intake',
    description: 'Lead intake and triage',
    keywords: [/\bintake\b/i, /\btriage\b/i, /\blead\b/i, /\bonboard\b/i],
  },
  {
    topic: 'gh-integration',
    description: 'GoHighLevel CRM actions',
    keywords: [/\bghl\b/i, /\bgohighlevel\b/i, /\bcontact\b/i, /\bdeal\b/i, /\bpipeline\b/i, /\bopportunity\b/i],
  },
  {
    topic: 'task',
    description: 'Task and project management',
    keywords: [/\btask\b/i, /\bboard\b/i, /\bkanban\b/i, /\bticket\b/i, /\bassign\b/i],
  },
  {
    topic: 'workspace',
    description: 'Workspace and memory management',
    keywords: [/\bworkspace\b/i, /\bmemory\b/i, /\bcontext\b/i, /\bnote\b/i],
  },
  {
    topic: 'support',
    description: 'Customer support actions',
    keywords: [/\bsupport\b/i, /\bhelp\b/i, /\bissue\b/i, /\bcomplaint\b/i],
  },
  {
    topic: 'configuration',
    description: 'Platform configuration via the Configuration Assistant',
    keywords: [/\bconfig/i, /\bset\s?up\b/i, /\bagent\b/i, /\bskill\b/i, /\bschedule\b/i, /\bsubaccount\b/i, /\blink\b/i, /\bcustom\s?instructions?\b/i, /\bdata\s?source\b/i, /\bheartbeat\b/i, /\bhealth\s?check\b/i, /\brestore\b/i, /\bhistory\b/i],
  },
];

/**
 * Get the set of all declared topic names.
 */
export function getAllTopicNames(): string[] {
  return TOPIC_REGISTRY.map((r) => r.topic);
}
