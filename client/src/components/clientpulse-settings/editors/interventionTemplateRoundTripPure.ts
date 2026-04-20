// ---------------------------------------------------------------------------
// Round-trip contract for the typed InterventionTemplatesEditor (spec §8.5).
// Serialiser (form-state → wire shape) + deserialiser (wire shape → form-state).
// Critical invariant: every template from effective.interventionTemplates must
// round-trip without data loss — unknown fields are preserved verbatim.
// ---------------------------------------------------------------------------

export type Band = 'healthy' | 'watch' | 'atRisk' | 'critical';

export type InterventionActionType =
  | 'crm.fire_automation'
  | 'crm.send_email'
  | 'crm.send_sms'
  | 'crm.create_task'
  | 'notify_operator';

export type InterventionTemplate = {
  slug: string;
  label: string;
  description?: string;
  gateLevel: 'auto' | 'review';
  actionType: InterventionActionType;
  targets?: Band[];
  priority?: number;
  measurementWindowHours?: number;
  defaultReason?: string;
  payloadDefaults?: Record<string, unknown>;
  /** Anything not explicitly modeled above is preserved verbatim on round-trip. */
  [key: string]: unknown;
};

export type TemplateFormState = {
  slug: string;
  label: string;
  description: string;
  gateLevel: 'auto' | 'review';
  actionType: InterventionActionType;
  targets: Band[];
  priority: number;
  measurementWindowHours: number;
  defaultReason: string;
  payloadDefaults: Record<string, unknown>;
  /** Carry-through bucket — fields the typed editor doesn't surface. */
  passthrough: Record<string, unknown>;
};

const KNOWN_KEYS = new Set([
  'slug',
  'label',
  'description',
  'gateLevel',
  'actionType',
  'targets',
  'priority',
  'measurementWindowHours',
  'defaultReason',
  'payloadDefaults',
]);

export function deserialiseTemplateForEdit(tpl: InterventionTemplate): TemplateFormState {
  const passthrough: Record<string, unknown> = {};
  for (const key of Object.keys(tpl)) {
    if (!KNOWN_KEYS.has(key)) passthrough[key] = tpl[key];
  }
  return {
    slug: tpl.slug ?? '',
    label: tpl.label ?? '',
    description: tpl.description ?? '',
    gateLevel: tpl.gateLevel ?? 'review',
    actionType: tpl.actionType,
    targets: Array.isArray(tpl.targets) ? [...tpl.targets] : [],
    priority: typeof tpl.priority === 'number' ? tpl.priority : 0,
    measurementWindowHours: typeof tpl.measurementWindowHours === 'number' ? tpl.measurementWindowHours : 24,
    defaultReason: tpl.defaultReason ?? '',
    payloadDefaults: tpl.payloadDefaults ?? {},
    passthrough,
  };
}

export function serialiseTemplateForSave(state: TemplateFormState): InterventionTemplate {
  const tpl: InterventionTemplate = {
    ...state.passthrough,
    slug: state.slug,
    label: state.label,
    gateLevel: state.gateLevel,
    actionType: state.actionType,
  };
  if (state.description.trim().length > 0) tpl.description = state.description;
  if (state.targets.length > 0) tpl.targets = state.targets;
  if (state.priority !== 0) tpl.priority = state.priority;
  if (state.measurementWindowHours !== 24) tpl.measurementWindowHours = state.measurementWindowHours;
  if (state.defaultReason.trim().length > 0) tpl.defaultReason = state.defaultReason;
  if (Object.keys(state.payloadDefaults).length > 0) tpl.payloadDefaults = state.payloadDefaults;
  return tpl;
}

/** Ensure every template's slug is unique within the array. Case-insensitive. */
export function validateUniqueSlugs(templates: TemplateFormState[]): string | null {
  const seen = new Set<string>();
  for (const t of templates) {
    const key = t.slug.trim().toLowerCase();
    if (!key) return `A template has an empty slug.`;
    if (seen.has(key)) return `Duplicate slug: ${t.slug}`;
    seen.add(key);
  }
  return null;
}
