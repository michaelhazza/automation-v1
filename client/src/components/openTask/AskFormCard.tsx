/**
 * AskFormCard — amber-tinted form card rendered in the Chat pane when an Ask
 * gate is open.
 *
 * Header: prompt text + "Ask" badge.
 * Body: form fields rendered via FormFieldRenderer.
 * Footer: Submit and (optional) Skip buttons.
 *
 * Submission: POST /api/tasks/:taskId/ask/:stepId/submit { values }
 * Skip:       POST /api/tasks/:taskId/ask/:stepId/skip {}
 *
 * Auto-fill on render: accepts pre-fill values via props.autoFillValues.
 *
 * Spec: docs/workflows-dev-spec.md §11.
 */

import { useState, useEffect } from 'react';
import api from '../../lib/api.js';
import FormFieldRenderer from './FormFieldRenderer.js';
import { validateAskForm } from './askFormValidationPure.js';
import type { AskFormSchema, AskFormValues, AskFormFieldDef } from '../../../../shared/types/askForm.js';

interface AskFormCardProps {
  taskId: string;
  gateId: string;
  stepId: string;
  schema: AskFormSchema;
  currentUserId: string;
  submitterPool: string[];
  /** Optional pre-filled values from caller. If omitted, fetched from autofill endpoint. */
  autoFillValues?: AskFormValues;
  onResolved?: () => void;
}

interface AlreadySubmittedState {
  submittedBy: string;
  submittedAt: string;
}

export default function AskFormCard({
  taskId,
  stepId,
  schema,
  currentUserId,
  submitterPool,
  autoFillValues,
  onResolved,
}: AskFormCardProps) {
  const [values, setValues] = useState<AskFormValues>(() => {
    // Seed with auto-fill values, then blank out any missing keys
    const seed: AskFormValues = {};
    for (const field of schema.fields) {
      if (autoFillValues && Object.prototype.hasOwnProperty.call(autoFillValues, field.key)) {
        seed[field.key] = autoFillValues[field.key];
      } else {
        seed[field.key] = field.type === 'multi_select' ? [] : null;
      }
    }
    return seed;
  });

  // Refresh values when auto-fill arrives after initial render
  useEffect(() => {
    if (!autoFillValues) return;
    setValues((prev: AskFormValues) => {
      const next = { ...prev };
      for (const field of schema.fields) {
        if (
          Object.prototype.hasOwnProperty.call(autoFillValues, field.key) &&
          autoFillValues[field.key] !== null
        ) {
          next[field.key] = autoFillValues[field.key];
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFillValues]);

  // Fetch autofill from server on mount if autoFillValues not provided by parent
  useEffect(() => {
    if (autoFillValues !== undefined) return; // parent already provided values
    api.get<{ values: AskFormValues }>(`/api/tasks/${taskId}/ask/${stepId}/autofill`)
      .then(({ data }) => {
        setValues((prev: AskFormValues) => {
          const next = { ...prev };
          for (const field of schema.fields) {
            if (
              Object.prototype.hasOwnProperty.call(data.values, field.key) &&
              data.values[field.key] !== null
            ) {
              next[field.key] = data.values[field.key];
            }
          }
          return next;
        });
      })
      .catch(() => { /* silent — autofill is best-effort */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, stepId]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState<AlreadySubmittedState | null>(null);
  const [resolved, setResolved] = useState(false);

  const isInPool = submitterPool.includes(currentUserId);

  function handleChange(key: string, value: AskFormValues[string]) {
    setValues((prev: AskFormValues) => ({ ...prev, [key]: value }));
    // Clear error on change
    if (fieldErrors[key]) {
      setFieldErrors((prev: Record<string, string>) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function handleSubmit() {
    const { valid, errors } = validateAskForm(schema, values);
    if (!valid) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post(`/api/tasks/${taskId}/ask/${stepId}/submit`, { values });
      setResolved(true);
      onResolved?.();
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: Record<string, unknown>; status?: number } })?.response;
      if (resp?.status === 409 && resp?.data?.error === 'already_submitted') {
        setAlreadySubmitted({
          submittedBy: String(resp.data.submitted_by ?? 'someone else'),
          submittedAt: String(resp.data.submitted_at ?? ''),
        });
      } else {
        const msg =
          (resp?.data as { error?: { message?: string } } | undefined)?.error?.message
          ?? (resp?.data as { error?: string } | undefined)?.error
          ?? 'Submission failed';
        setSubmitError(typeof msg === 'string' ? msg : 'Submission failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setSkipping(true);
    setSubmitError(null);
    try {
      await api.post(`/api/tasks/${taskId}/ask/${stepId}/skip`, {});
      setResolved(true);
      onResolved?.();
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: Record<string, unknown>; status?: number } })?.response;
      const msg =
        (resp?.data as { error?: { message?: string } } | undefined)?.error?.message
        ?? (resp?.data as { error?: string } | undefined)?.error
        ?? 'Skip failed';
      setSubmitError(typeof msg === 'string' ? msg : 'Skip failed');
    } finally {
      setSkipping(false);
    }
  }

  if (resolved) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3">
        <p className="text-[13px] text-slate-400">Response submitted.</p>
      </div>
    );
  }

  if (alreadySubmitted) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3">
        <p className="text-[13px] text-slate-400">
          Already submitted by {alreadySubmitted.submittedBy}
          {alreadySubmitted.submittedAt
            ? ` at ${new Date(alreadySubmitted.submittedAt).toLocaleString()}`
            : ''}.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 rounded-lg border border-amber-700/50 bg-amber-950/25 overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-amber-800/30">
        <p className="text-[13.5px] font-medium text-amber-200 leading-snug flex-1">
          {schema.prompt}
        </p>
        <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300 border border-amber-700/50">
          Ask
        </span>
      </div>

      {/* Fields */}
      {schema.fields.length > 0 && (
        <div className="px-4 py-3 flex flex-col gap-3">
          {schema.fields.map((field: AskFormFieldDef) => (
            <FormFieldRenderer
              key={field.key}
              field={field}
              value={values[field.key] ?? null}
              onChange={handleChange}
              error={fieldErrors[field.key]}
              disabled={!isInPool || submitting || skipping}
            />
          ))}
        </div>
      )}

      {/* Error banner */}
      {submitError && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-md bg-red-900/30 border border-red-700/40">
          <p className="text-[12px] text-red-400">{submitError}</p>
        </div>
      )}

      {/* Not in pool */}
      {!isInPool && (
        <div className="px-4 pb-3">
          <p className="text-[12px] text-slate-500">You are not in the submitter pool for this step.</p>
        </div>
      )}

      {/* Actions */}
      {isInPool && (
        <div className="px-4 pb-3 flex gap-2 justify-end">
          {schema.allowSkip && (
            <button
              type="button"
              onClick={() => void handleSkip()}
              disabled={submitting || skipping}
              className="rounded-md border border-slate-600 hover:bg-slate-700 disabled:opacity-50 px-3 py-1.5 text-[13px] font-medium text-slate-400 transition-colors"
            >
              {skipping ? 'Skipping...' : 'Skip'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || skipping}
            className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-1.5 text-[13px] font-medium text-white transition-colors"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
}
