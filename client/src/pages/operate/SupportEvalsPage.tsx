// client/src/pages/operate/SupportEvalsPage.tsx
//
// Admin page for the Support Agent eval harness.
// Route: /operate/agents/support/evals
//
// Displays the latest eval run results: classification accuracy per intent,
// judge score, row count, partial warning, and drift indicator.
//
// Spec §5.5.4

import React, { useEffect, useState } from 'react';
import type { User } from '../../lib/auth';
import { PageShell } from '../../components/PageShell';
import api from '../../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalRun {
  id: string;
  runAt: string;
  classificationAccuracyPerIntent: Record<string, number>;
  draftJudgeScoreAvg: string; // numeric(4,2) comes back as string from Postgres
  thresholdClassificationMin: string;
  thresholdJudgeMin: string;
  promptVersion: number;
  modelId: string;
  rowCount: number;
  partial: boolean;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SupportEvalsPageProps {
  user?: User;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avgAccuracy(accuracy: Record<string, number>): number {
  const values = Object.values(accuracy);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// Returns true when current avg accuracy is >10% below previous
function hasClassificationDrift(current: EvalRun, previous: EvalRun): boolean {
  const currentAvg = avgAccuracy(current.classificationAccuracyPerIntent);
  const prevAvg = avgAccuracy(previous.classificationAccuracyPerIntent);
  return prevAvg > 0 && currentAvg - prevAvg < -0.10;
}

function hasJudgeDrift(current: EvalRun, previous: EvalRun): boolean {
  return Number(current.draftJudgeScoreAvg) - Number(previous.draftJudgeScoreAvg) < -0.10;
}

// ---------------------------------------------------------------------------
// EvalRunCard
// ---------------------------------------------------------------------------

function EvalRunCard({
  run,
  previous,
  isLatest,
}: {
  run: EvalRun;
  previous: EvalRun | null;
  isLatest: boolean;
}) {
  const classificationAvg = avgAccuracy(run.classificationAccuracyPerIntent);
  const classificationThreshold = Number(run.thresholdClassificationMin);
  const judgeScore = Number(run.draftJudgeScoreAvg);
  const judgeThreshold = Number(run.thresholdJudgeMin);

  const classificationOk = classificationAvg >= classificationThreshold;
  const judgeOk = judgeScore >= judgeThreshold;

  const classificationDrift = isLatest && previous !== null && hasClassificationDrift(run, previous);
  const judgeDrift = isLatest && previous !== null && hasJudgeDrift(run, previous);

  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            {new Date(run.runAt).toLocaleString()}
          </span>
          {isLatest && (
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">Latest</span>
          )}
          {run.partial && (
            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">Partial run</span>
          )}
        </div>
        <span className="text-xs text-gray-400">
          {run.rowCount} fixtures, model {run.modelId}, prompt v{run.promptVersion}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">Classification accuracy</span>
            {classificationDrift && (
              <span className="text-xs text-amber-600">drop &gt;10%</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-semibold ${classificationOk ? 'text-green-700' : 'text-red-600'}`}>
              {pct(classificationAvg)}
            </span>
            <span className="text-xs text-gray-400">threshold {pct(classificationThreshold)}</span>
          </div>
          {Object.entries(run.classificationAccuracyPerIntent).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(run.classificationAccuracyPerIntent).map(([intent, acc]) => (
                <div key={intent} className="flex items-center justify-between text-xs text-gray-600">
                  <span>{intent}</span>
                  <span>{pct(acc)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">Draft judge score</span>
            {judgeDrift && (
              <span className="text-xs text-amber-600">drop &gt;10%</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-semibold ${judgeOk ? 'text-green-700' : 'text-red-600'}`}>
              {pct(judgeScore)}
            </span>
            <span className="text-xs text-gray-400">threshold {pct(judgeThreshold)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SupportEvalsPage
// ---------------------------------------------------------------------------

export function SupportEvalsPage({ user: _user }: SupportEvalsPageProps): React.ReactElement {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ runs: EvalRun[] }>('/api/support/evals/latest')
      .then((res) => {
        setRuns(res.data.runs);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[SupportEvalsPage] fetch error:', err);
        setError('Failed to load eval results. Please try again.');
        setLoading(false);
      });
  }, []);

  const header = (
    <div className="page-header px-6 py-4 border-b border-gray-200">
      <h1 className="text-xl font-semibold text-gray-900">Support Agent Evals</h1>
      <p className="text-sm text-gray-500 mt-1">
        Daily regression results for classification accuracy and draft quality.
      </p>
    </div>
  );

  return (
    <PageShell header={header}>
      <div className="px-6 py-4">
        {loading && (
          <div className="text-sm text-gray-500">Loading eval results...</div>
        )}

        {error && (
          <div className="text-sm text-red-600">{error}</div>
        )}

        {!loading && !error && runs.length === 0 && (
          <div className="text-sm text-gray-500">
            No eval runs yet. The daily job runs automatically, or an admin can trigger a run via the API.
          </div>
        )}

        {!loading && !error && runs.length > 0 && (
          <div>
            {runs.map((run, i) => (
              <EvalRunCard
                key={run.id}
                run={run}
                previous={runs[i + 1] ?? null}
                isLatest={i === 0}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
