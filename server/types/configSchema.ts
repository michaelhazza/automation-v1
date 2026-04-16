/**
 * configSchema — canonical Configuration Schema types (§9.2 + §9.4)
 *
 * Single source of truth for:
 *   - per-playbook question declarations (ConfigQuestion)
 *   - parser output after document ingestion (ParsedConfigField)
 *
 * The onboarding conversation, async Configuration Document pipeline, live
 * chat follow-up, and gap analysis ALL consume these two shapes unchanged.
 * No variant (e.g. a { fieldId: answer } map) is used anywhere else — any
 * new consumer must accept `ParsedConfigField[]` and treat it as authoritative.
 *
 * Spec: docs/memory-and-briefings-spec.md §9.2, §9.4 (S21)
 */

// ---------------------------------------------------------------------------
// ConfigQuestion — the playbook-declared question
// ---------------------------------------------------------------------------

export type ConfigQuestionType =
  | 'text'
  | 'select'
  | 'multiselect'
  | 'datetime'
  | 'url'
  | 'email'
  | 'boolean'
  | 'deliveryChannels';

export interface ConfigQuestion {
  /** Unique key, e.g. "briefing.schedule_day". */
  id: string;
  /** Grouping label for display. */
  section: string;
  /** Human-readable question text. */
  question: string;
  /** Additional context / examples. */
  helpText?: string;
  /** Type discriminator — governs UI widget + parser validation. */
  type: ConfigQuestionType;
  /** For select/multiselect types. */
  options?: string[];
  /** Default value. Type-aligned with `type`. */
  default?: string | string[] | boolean;
  /** Whether an answer is required for markReady. */
  required: boolean;
  /** Validation hint for users + parser prompts. */
  validationHint?: string;
  /**
   * Smart-skipping hints — IDs of upstream questions (or keywords like
   * "website_url", "website_html") whose answers can derive this one.
   */
  derivableFrom?: string[];
}

// ---------------------------------------------------------------------------
// ParsedConfigField — parser output (the ONLY downstream shape)
// ---------------------------------------------------------------------------

export type ParsedAnswer = string | string[] | boolean | null;

export interface ParsedConfigField {
  /** Matches ConfigQuestion.id. */
  fieldId: string;
  /** Answer value typed per ConfigQuestion.type; null when unanswered. */
  answer: ParsedAnswer;
  /** Confidence score in [0, 1]. Parser assigns; downstream gates on threshold. */
  confidence: number;
  /** Optional raw text fragment the answer was derived from. */
  sourceExcerpt?: string;
  /** Set by validation — invalidates the parsed field without dropping the row. */
  invalid?: boolean;
  /** Human-readable reason surfaced in follow-up conversation when invalid. */
  invalidReason?: string;
}

// ---------------------------------------------------------------------------
// Outcome routing types (for configDocumentParserService)
// ---------------------------------------------------------------------------

export type ConfigDocumentOutcome = 'auto_apply' | 'gaps' | 'rejected';

export interface ConfigDocumentSummary {
  /** Every field the parser attempted to fill, including low-confidence and invalid rows. */
  parsed: ParsedConfigField[];
  /** High-confidence, valid, required fields that can auto-apply. */
  autoApplyFields: ParsedConfigField[];
  /** Required fields that are unanswered or below confidence threshold. */
  gaps: ParsedConfigField[];
  /** The routing decision. */
  outcome: ConfigDocumentOutcome;
  /** When outcome='rejected', the reason surfaced to the UI. */
  rejectionReason?: string;
}
