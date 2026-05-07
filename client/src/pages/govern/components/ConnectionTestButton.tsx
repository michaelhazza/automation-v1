// client/src/pages/govern/components/ConnectionTestButton.tsx
// Spec: tasks/builds/consolidation-govern/spec.md §4.9

import { useState } from 'react';
import { testConnection } from '../../../api/governApi';

interface Props {
  connectionId: string;
}

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; latencyMs: number }
  | { phase: 'failed'; code: string };

export function ConnectionTestButton({ connectionId }: Props) {
  const [state, setState] = useState<TestState>({ phase: 'idle' });

  async function handleTest() {
    if (state.phase === 'testing') return;
    setState({ phase: 'testing' });
    try {
      const res = await testConnection(connectionId);
      if (res.status === 'ok') {
        setState({ phase: 'ok', latencyMs: res.latencyMs });
      } else {
        setState({ phase: 'failed', code: res.error?.code ?? 'ERROR' });
      }
    } catch {
      setState({ phase: 'failed', code: 'ERROR' });
    }
  }

  const busy = state.phase === 'testing';

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleTest}
        disabled={busy}
        className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? 'Testing...' : 'Test'}
      </button>
      {state.phase === 'ok' && (
        <span className="text-xs font-medium text-emerald-600">
          OK &middot; {state.latencyMs}ms
        </span>
      )}
      {state.phase === 'failed' && (
        <span className="text-xs font-medium text-red-600">
          Failed &middot; {state.code}
        </span>
      )}
    </span>
  );
}
