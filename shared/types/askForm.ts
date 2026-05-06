export type AskFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multi-select'
  | 'number'
  | 'date'
  | 'checkbox';

export interface AskField {
  key: string;
  label: string;
  type: AskFieldType;
  required: boolean;
  help_text?: string;
  error_message?: string;
  options?: Array<{ value: string; label: string }>; // select / multi-select only
  min?: number;
  max?: number; // number only
}

export interface AskParams {
  prompt: string;
  fields: AskField[];
  submitterGroup: {
    kind: 'specific_users' | 'team' | 'task_requester' | 'org_admin';
    userIds?: string[];
    teamId?: string;
  };
  quorum: 1;
  autoFillFrom: 'none' | 'last_completed_run';
  allowSkip: boolean;
}
