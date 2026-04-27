// Renders the agent_diagnosis block in the incident detail drawer.
// Shows 5 distinct states per spec §10.3.
import { useState } from 'react';

const TRIAGE_ATTEMPT_CAP = 5;
const IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;

type Severity = 'low' | 'medium' | 'high' | 'critical';
type Source = string;

function isSweepEligible(severity: Severity, source: Source): boolean {
  return severity !== 'low' && source !== 'self';
}

function isInFlight(lastTriageAttemptAt: string | null): boolean {
  if (!lastTriageAttemptAt) return false;
  return Date.now() - new Date(lastTriageAttemptAt).getTime() < IN_FLIGHT_WINDOW_MS;
}

interface Props {
  agentDiagnosis: Record<string, unknown> | null;
  investigatePrompt: string | null;
  triageAttemptCount: number;
  lastTriageAttemptAt: string | null;
  severity: Severity;
  source: Source;
}

export default function DiagnosisAnnotation({
  agentDiagnosis,
  investigatePrompt,
  triageAttemptCount,
  lastTriageAttemptAt,
  severity,
  source,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  // State 1: diagnosis present
  if (agentDiagnosis !== null) {
    const validationFailed = agentDiagnosis !== null && investigatePrompt === null;
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px]">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-slate-700 text-[12px]">Agent diagnosis</span>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-[11px] text-indigo-600 hover:text-indigo-800"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {validationFailed && (
          <div className="text-red-600 text-[11px] mb-2 font-medium">
            Prompt validation failed — operator should investigate manually.
          </div>
        )}
        {expanded ? (
          <pre className="text-[11px] text-slate-700 whitespace-pre-wrap break-words bg-white rounded border border-slate-100 p-2 overflow-x-auto">
            {JSON.stringify(agentDiagnosis, null, 2)}
          </pre>
        ) : (
          <div className="text-slate-600 line-clamp-3 text-[11px]">
            {String(agentDiagnosis.summary ?? agentDiagnosis.conclusion ?? 'Diagnosis recorded — expand to view').slice(0, 200)}
          </div>
        )}
      </div>
    );
  }

  // State 2: self-check skipped
  if (source === 'self' || (agentDiagnosis === null && triageAttemptCount === 0 && !isSweepEligible(severity, source))) {
    return (
      <div className="text-[12px] text-slate-500 italic">Auto-triage skipped (self-check incident).</div>
    );
  }

  // State 3: low severity skipped
  if (severity === 'low' && triageAttemptCount === 0) {
    return (
      <div className="text-[12px] text-slate-500 italic">Auto-triage skipped (low severity) — manual escalate available.</div>
    );
  }

  // State 4: in-flight (triaging)
  if (triageAttemptCount > 0 && isInFlight(lastTriageAttemptAt)) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-slate-600">
        <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        Triaging…
      </div>
    );
  }

  // State 5: rate-limited / failed
  if (triageAttemptCount > 0) {
    const rateLimited = triageAttemptCount >= TRIAGE_ATTEMPT_CAP;
    if (rateLimited) {
      return (
        <div className="text-[12px] text-amber-700 bg-amber-50 rounded p-2 border border-amber-200">
          Auto-triage rate-limited — manual escalate available.
        </div>
      );
    }
    // Triage attempted but stalled
    return (
      <div className="text-[12px] text-slate-500 italic">Triage attempted but no diagnosis recorded yet.</div>
    );
  }

  // State: awaiting (eligible, no attempt yet)
  if (isSweepEligible(severity, source)) {
    return (
      <div className="text-[12px] text-slate-500 italic">Awaiting auto-triage.</div>
    );
  }

  return null;
}
