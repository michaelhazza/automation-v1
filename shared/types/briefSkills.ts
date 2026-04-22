// Shared types for Universal Brief skill outputs.
// Phase 4 — Clarifying + Sparring Partner skills.
// Spec: docs/universal-brief-dev-spec.md §4.4, §4.5

export interface ClarifyingQuestion {
  /** Human-readable question, ≤ 140 chars. */
  question: string;
  /** Why this question reduces ambiguity. */
  rationale: string;
  /** Which intent dimension this clarifies. */
  ambiguityDimension: 'scope' | 'target' | 'action' | 'timing' | 'content' | 'other';
  /** Optional multi-choice options the UI can present as chips. */
  suggestedAnswers?: string[];
}

export interface ClarifyingQuestionsPayload {
  /** ≤ 5 questions, ranked by ambiguity-reduction impact. */
  questions: ClarifyingQuestion[];
  /** Orchestrator's confidence before asking questions, 0.0–1.0. */
  confidenceBefore: number;
  /** Expected confidence after all questions answered, 0.0–1.0. Must be > confidenceBefore. */
  expectedConfidenceAfter: number;
}

export interface ChallengeItem {
  /** Human-readable concern, ≤ 140 chars. */
  concern: string;
  severity: 'low' | 'medium' | 'high';
  /** What class of risk. */
  dimension:
    | 'irreversibility'
    | 'cost'
    | 'scope'
    | 'assumption'
    | 'evidence'
    | 'timing'
    | 'compliance'
    | 'other';
  /** Optional reference: artefactId, rule name, or data point. */
  evidenceRef?: string;
  /** How to address this concern. */
  recommendedAction?:
    | 'proceed_with_awareness'
    | 'defer'
    | 'narrow_scope'
    | 'gather_evidence'
    | 'reject';
}

export interface ChallengeAssumptionsPayload {
  /** ≤ 5 items, ranked by severity. */
  items: ChallengeItem[];
  /** Rolled up from items: 'high' if any high; 'medium' if any medium; else 'low'. */
  overallRisk: 'low' | 'medium' | 'high';
}
