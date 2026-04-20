// ---------------------------------------------------------------------------
// GoHighLevel endpoint mappings for the 5 ClientPulse intervention primitives.
// Spec §2.4. URL templates reference {locationId} and {contactId} / {workflowId}
// placeholders; apiAdapter.ts substitutes them at dispatch time.
// ---------------------------------------------------------------------------

export type GhlEndpointKey =
  | 'crm.fire_automation'
  | 'crm.send_email'
  | 'crm.send_sms'
  | 'crm.create_task'
  | 'notify_operator';

export type GhlEndpointSpec = {
  /** URL template — `{workflowId}`, `{contactId}` placeholders substituted at dispatch. */
  urlTemplate: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Required payload fields (for defence-in-depth validation before dispatch). */
  requiredFields: readonly string[];
  /** Optional payload fields (pass-through; not validated). */
  optionalFields?: readonly string[];
  /** `true` when the primitive does NOT make an external call (e.g. notify_operator fan-out). */
  internal?: true;
};

export const GHL_ENDPOINTS: Record<GhlEndpointKey, GhlEndpointSpec> = {
  'crm.fire_automation': {
    urlTemplate: '/hooks/workflows/{workflowId}/subscribe',
    method: 'POST',
    requiredFields: ['workflowId', 'contactId'],
  },
  'crm.send_email': {
    urlTemplate: '/contacts/{contactId}/emails',
    method: 'POST',
    requiredFields: ['contactId', 'subject', 'body', 'fromAddress'],
    optionalFields: ['replyToAddress'],
  },
  'crm.send_sms': {
    urlTemplate: '/contacts/{contactId}/sms',
    method: 'POST',
    requiredFields: ['contactId', 'message', 'fromNumber'],
  },
  'crm.create_task': {
    urlTemplate: '/contacts/{contactId}/tasks',
    method: 'POST',
    requiredFields: ['contactId', 'assigneeUserId', 'title', 'dueAt'],
    optionalFields: ['notes', 'priority'],
  },
  // Fan-out lives in Phase 8.3 (notifyOperatorFanoutService); adapter short-circuits.
  notify_operator: {
    urlTemplate: '',
    method: 'POST',
    requiredFields: [],
    internal: true,
  },
};

/**
 * Substitute `{key}` placeholders in a URL template with values from a payload map.
 * Throws if a required placeholder is missing from the payload.
 */
export function substituteUrlTemplate(
  template: string,
  payload: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = payload[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required URL placeholder: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}
