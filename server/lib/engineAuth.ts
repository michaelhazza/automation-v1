/**
 * Shared engine authentication header builder used by queueService and processService.
 * Each engine type uses a different auth header convention.
 */

export function buildEngineAuthHeaders(
  engineType: string,
  apiKey?: string
): Record<string, string> {
  if (!apiKey) return {};

  switch (engineType) {
    case 'n8n':
      return { 'X-N8N-API-KEY': apiKey };
    case 'make':
      // Make.com webhooks embed the secret in the URL; still include as Bearer
      // for self-hosted instances that validate headers.
      return { Authorization: `Bearer ${apiKey}` };
    case 'zapier':
      return { Authorization: `Bearer ${apiKey}` };
    case 'ghl':
      return { Authorization: `Bearer ${apiKey}` };
    case 'custom_webhook':
    default:
      return { Authorization: `Bearer ${apiKey}` };
  }
}
