import type { ClarifyingQuestionsPayload, ClarifyingQuestion } from '../../../../shared/types/briefSkills.js';
import { ConfidenceBadge } from './ConfidenceBadge.js';

interface ClarifyingQuestionsCardProps {
  payload: ClarifyingQuestionsPayload;
  onAnswer?: (questionIndex: number, answer: string) => void;
  onProceedAnyway?: () => void;
  isAnswered?: boolean;
}

const DIMENSION_LABELS: Record<ClarifyingQuestion['ambiguityDimension'], string> = {
  scope: 'Scope',
  target: 'Target',
  action: 'Action',
  timing: 'Timing',
  content: 'Content',
  other: 'Other',
};

export function ClarifyingQuestionsCard({
  payload,
  onAnswer,
  onProceedAnyway,
  isAnswered = false,
}: ClarifyingQuestionsCardProps) {
  return (
    <div className={`rounded-lg border border-yellow-200 bg-yellow-50 p-4 ${isAnswered ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-medium text-gray-900">
          A few things to clarify
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <ConfidenceBadge confidence={payload.confidenceBefore} />
          <span className="text-xs text-gray-500 whitespace-nowrap">
            → {Math.round(payload.expectedConfidenceAfter * 100)}% expected
          </span>
        </div>
      </div>

      <ol className="space-y-3">
        {payload.questions.map((q, i) => (
          <li key={i} className="text-sm">
            <div className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-yellow-200 text-yellow-800 text-xs font-semibold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 mb-1">{q.question}</p>
                <p className="text-xs text-gray-500 mb-2">
                  {DIMENSION_LABELS[q.ambiguityDimension]} — {q.rationale}
                </p>
                {q.suggestedAnswers && q.suggestedAnswers.length > 0 && !isAnswered && (
                  <div className="flex flex-wrap gap-1.5">
                    {q.suggestedAnswers.map((ans) => (
                      <button
                        key={ans}
                        onClick={() => onAnswer?.(i, ans)}
                        className="px-2.5 py-1 text-xs bg-white border border-yellow-300 text-gray-700 rounded-full hover:bg-yellow-100 transition-colors"
                      >
                        {ans}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {!isAnswered && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={onProceedAnyway}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Proceed anyway
          </button>
        </div>
      )}
    </div>
  );
}
