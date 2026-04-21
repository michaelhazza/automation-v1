import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type {
  AgentExecutionEvent,
  AgentRunLlmPayload,
  AgentRunPrompt,
} from '../../../../shared/types/agentExecutionLog';

interface Props {
  event: AgentExecutionEvent | null;
  runId: string;
  onClose: () => void;
}

type FetchState = 'idle' | 'loading' | 'forbidden' | 'error';

export default function EventDetailDrawer({ event, runId, onClose }: Props) {
  const [payload, setPayload] = useState<AgentRunLlmPayload | null>(null);
  const [prompt, setPrompt] = useState<AgentRunPrompt | null>(null);
  // Separate state machines so a prompt fetch can't be confused by an
  // in-flight payload fetch (and vice versa). Each CTA renders against
  // its own state.
  const [payloadState, setPayloadState] = useState<FetchState>('idle');
  const [promptState, setPromptState] = useState<FetchState>('idle');

  useEffect(() => {
    setPayload(null);
    setPrompt(null);
    setPayloadState('idle');
    setPromptState('idle');
  }, [event?.id]);

  if (!event) return null;

  async function fetchLlmPayload(llmRequestId: string) {
    setPayloadState('loading');
    try {
      const { data } = await api.get(`/api/agent-runs/${runId}/llm-payloads/${llmRequestId}`);
      setPayload((data?.data ?? null) as AgentRunLlmPayload | null);
      setPayloadState('idle');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setPayloadState(status === 403 ? 'forbidden' : 'error');
    }
  }

  async function fetchPrompt(assemblyNumber: number) {
    setPromptState('loading');
    try {
      const { data } = await api.get(`/api/agent-runs/${runId}/prompts/${assemblyNumber}`);
      setPrompt((data?.data ?? null) as AgentRunPrompt | null);
      setPromptState('idle');
    } catch {
      setPromptState('error');
    }
  }

  const llmRequestId =
    event.payload && 'llmRequestId' in event.payload
      ? (event.payload as { llmRequestId?: string }).llmRequestId
      : undefined;
  const assemblyNumber =
    event.payload && 'assemblyNumber' in event.payload
      ? (event.payload as { assemblyNumber?: number }).assemblyNumber
      : undefined;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/30"
      onClick={onClose}
    >
      <aside
        className="w-full max-w-xl h-full bg-white shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b flex items-center">
          <h2 className="text-sm font-semibold text-slate-900">
            {event.eventType} <span className="text-slate-400 font-mono">#{event.sequenceNumber}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-slate-500 hover:text-slate-700"
            aria-label="Close detail drawer"
          >
            ×
          </button>
        </header>

        <section className="p-4 space-y-3">
          <div className="text-xs text-slate-500">
            {new Date(event.eventTimestamp).toLocaleString()} · {event.sourceService}
          </div>

          {event.linkedEntity && (
            <div className="text-sm">
              <div className="font-medium text-slate-700">Linked entity</div>
              <div className="text-slate-600">{event.linkedEntity.label}</div>
              <div className="flex gap-2 text-xs mt-1">
                {event.permissionMask.viewHref && (
                  <a href={event.permissionMask.viewHref} className="text-indigo-600 hover:underline">
                    View
                  </a>
                )}
                {event.permissionMask.editHref && (
                  <a href={event.permissionMask.editHref} className="text-indigo-600 hover:underline">
                    Edit
                  </a>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="text-sm font-medium text-slate-700 mb-1">Payload</div>
            <pre className="text-xs bg-slate-50 rounded p-3 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>

          {llmRequestId && (
            <div>
              {!payload && payloadState !== 'forbidden' && (
                <button
                  type="button"
                  onClick={() => fetchLlmPayload(llmRequestId)}
                  disabled={payloadState === 'loading' || !event.permissionMask.canViewPayload}
                  className="text-xs rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
                >
                  {payloadState === 'loading' ? 'Fetching…' : 'Fetch full payload'}
                </button>
              )}
              {!event.permissionMask.canViewPayload && (
                <div className="text-xs text-slate-500 mt-2">
                  Payload view requires agent-edit permission.
                </div>
              )}
              {payloadState === 'forbidden' && (
                <div className="text-xs text-slate-500 mt-2">
                  You do not have permission to view this payload.
                </div>
              )}
              {payloadState === 'error' && (
                <div className="text-xs text-rose-600 mt-2">
                  Payload fetch failed.
                </div>
              )}
              {payload && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-slate-500">
                    {payload.totalSizeBytes.toLocaleString()} bytes
                    {payload.modifications.length > 0 && (
                      <span className="ml-2 text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
                        {payload.modifications.length} modification(s)
                      </span>
                    )}
                    {payload.redactedFields.length > 0 && (
                      <span className="ml-2 text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">
                        {payload.redactedFields.length} redaction(s)
                      </span>
                    )}
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer">System prompt</summary>
                    <pre className="bg-slate-50 rounded p-2 mt-1 whitespace-pre-wrap break-words">
                      {payload.systemPrompt}
                    </pre>
                  </details>
                  <details className="text-xs">
                    <summary className="cursor-pointer">Messages</summary>
                    <pre className="bg-slate-50 rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(payload.messages, null, 2)}
                    </pre>
                  </details>
                  <details className="text-xs">
                    <summary className="cursor-pointer">Response</summary>
                    <pre className="bg-slate-50 rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(payload.response, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}

          {assemblyNumber !== undefined && (
            <div>
              {!prompt && (
                <button
                  type="button"
                  onClick={() => fetchPrompt(assemblyNumber)}
                  disabled={promptState === 'loading'}
                  className="text-xs rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
                >
                  {promptState === 'loading' ? 'Fetching…' : 'View full prompt'}
                </button>
              )}
              {promptState === 'error' && (
                <div className="text-xs text-rose-600 mt-2">Prompt fetch failed.</div>
              )}
              {prompt && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-slate-500">
                    Assembly #{prompt.assemblyNumber} · {prompt.totalTokens.toLocaleString()} tokens
                  </div>
                  <details className="text-xs" open>
                    <summary className="cursor-pointer">System prompt</summary>
                    <pre className="bg-slate-50 rounded p-2 mt-1 whitespace-pre-wrap break-words">
                      {prompt.systemPrompt}
                    </pre>
                  </details>
                  {prompt.userPrompt && (
                    <details className="text-xs">
                      <summary className="cursor-pointer">User prompt</summary>
                      <pre className="bg-slate-50 rounded p-2 mt-1 whitespace-pre-wrap break-words">
                        {prompt.userPrompt}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

        </section>
      </aside>
    </div>
  );
}
