import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { AskGateProjection } from '../../../../shared/types/taskProjection';
import type { AskParams } from '../../../../shared/types/askForm';
import { FormFieldRenderer } from './FormFieldRenderer';
import { validateAskForm } from './askFormValidationPure';

interface AskFormCardProps {
  gate: AskGateProjection;
  taskId: string;
}

export function AskFormCard({ gate, taskId }: AskFormCardProps) {
  const params = gate.schema as AskParams | null;

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<'pending' | 'submitted' | 'skipped'>(
    gate.status,
  );
  const [submittedBy, setSubmittedBy] = useState<string | null>(gate.submittedBy ?? null);

  // Fetch auto-fill values on mount (only when pending and autoFillFrom is set).
  useEffect(() => {
    if (localStatus !== 'pending' || !params || params.autoFillFrom === 'none') return;
    const fieldsParam = encodeURIComponent(JSON.stringify(params.fields));
    void api
      .get<{ values: Record<string, unknown> }>(
        `/api/tasks/${taskId}/ask/${gate.stepId}/autofill?fields=${fieldsParam}`,
      )
      .then(({ data }) => {
        if (data.values && Object.keys(data.values).length > 0) {
          setValues((prev) => ({ ...data.values, ...prev }));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.stepId, taskId]);

  function handleChange(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function handleSubmit() {
    if (!params) return;
    const validation = validateAskForm(params.fields, values);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    setSubmitting(true);
    setInlineError(null);
    try {
      await api.post(`/api/tasks/${taskId}/ask/${gate.stepId}/submit`, { values });
      setLocalStatus('submitted');
      setSubmittedBy('you');
    } catch (err: unknown) {
      const shaped = err as { response?: { status?: number; data?: { error?: string } } };
      const status = shaped.response?.status;
      const code = shaped.response?.data?.error;
      if (status === 409 && code === 'already_resolved') {
        setInlineError('Someone else already submitted this form');
      } else if (status === 403) {
        setInlineError('You are not authorised to submit this form');
      } else {
        setInlineError('Submission failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setSubmitting(true);
    setInlineError(null);
    try {
      await api.post(`/api/tasks/${taskId}/ask/${gate.stepId}/skip`, {});
      setLocalStatus('skipped');
      setSubmittedBy('you');
    } catch (err: unknown) {
      const shaped = err as { response?: { status?: number; data?: { error?: string } } };
      const status = shaped.response?.status;
      const code = shaped.response?.data?.error;
      if (status === 400 && code === 'skip_not_allowed') {
        setInlineError('Skip is not allowed for this form');
      } else if (status === 403) {
        setInlineError('You are not authorised to skip this form');
      } else {
        setInlineError('Skip failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (localStatus === 'submitted' || localStatus === 'skipped') {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3">
        <p className="text-[13px] font-semibold text-emerald-800">
          {localStatus === 'skipped' ? 'Skipped' : 'Submitted'}
        </p>
        {submittedBy && (
          <p className="text-[11px] text-emerald-600 mt-0.5">
            {localStatus === 'skipped' ? 'Skipped' : 'Submitted'} by {submittedBy}
          </p>
        )}
      </div>
    );
  }

  if (!params) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
        <p className="text-[13px] font-semibold text-amber-800">Input required</p>
        <p className="text-[12px] text-amber-700 mt-1">{gate.prompt}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 space-y-3">
      <p className="text-[13px] font-semibold text-amber-800">Input required</p>
      <p className="text-[12px] text-amber-700">{params.prompt}</p>

      <div className="space-y-3">
        {params.fields.map((field) => (
          <FormFieldRenderer
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={handleChange}
            error={errors[field.key]}
          />
        ))}
      </div>

      {inlineError && (
        <p className="text-[12px] text-red-600">{inlineError}</p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="rounded bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          disabled={submitting}
          onClick={() => void handleSubmit()}
        >
          Submit
        </button>
        {params.allowSkip && (
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 disabled:opacity-50"
            disabled={submitting}
            onClick={() => void handleSkip()}
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
