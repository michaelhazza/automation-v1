import api from '../api';

export interface ValidatorEvidence {
  field?: string;
  expected?: unknown;
  actual?: unknown;
  matchedSubstring?: string;
  missingIds?: string[];
  _truncated?: true;
  [key: string]: unknown;
}

export interface ValidatorParameterField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: unknown;
  description: string;
  uiHint?: 'textarea' | 'code-editor' | 'json-schema' | 'slug-picker' | 'number-range';
  validation?: { min?: number; max?: number; pattern?: string; enum?: unknown[] };
}

export interface ValidatorSummary {
  slug: string;
  name: string;
  kind: 'deterministic' | 'deterministic_external' | 'hybrid_precondition';
  safetyClass: boolean;
  deprecated: boolean;
  parameterSchema: ValidatorParameterField[];
}

export async function listValidators(): Promise<ValidatorSummary[]> {
  try {
    const { data } = await api.get<ValidatorSummary[]>('/api/validators');
    return data;
  } catch {
    return [];
  }
}
