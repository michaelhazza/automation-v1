import { useEffect, useState } from 'react';
import { fetchHealth, fetchInFlight, type HealthResponse, type InFlightItem } from './lib/api.js';
import { InFlightCard } from './components/InFlightCard.js';

const POLL_INTERVAL_MS = 30_000;

export function App() {
  const [items, setItems] = useState<InFlightItem[] | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [h, i] = await Promise.all([fetchHealth(), fetchInFlight()]);
        if (cancelled) return;
        setHealth(h);
        setItems(i);
        setError(null);
        setLastFetched(new Date());
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Mission Control</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {health?.githubRepo ? (
                <>
                  <span className="font-mono">{health.githubRepo}</span>
                  {!health.hasGithubToken && (
                    <span className="ml-2 text-amber-400">
                      (no GITHUB_TOKEN — public-rate-limited)
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-600">repo not configured</span>
              )}
            </p>
          </div>
          {lastFetched && (
            <div className="text-[11px] text-slate-500">
              updated {lastFetched.toLocaleTimeString()}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <strong>error:</strong> {error}
          </div>
        )}

        {items === null && !error && (
          <p className="text-slate-500 text-sm">loading…</p>
        )}

        {items !== null && items.length === 0 && (
          <div className="rounded border border-slate-800 bg-slate-900/30 p-6 text-center text-slate-400">
            <p className="text-sm">No builds in flight.</p>
            <p className="mt-2 text-xs text-slate-500">
              Mission Control reads <code className="font-mono text-slate-400">tasks/builds/</code> for
              build slugs. Create a build directory to see it here.
            </p>
          </div>
        )}

        {items && items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => (
              <InFlightCard key={item.build_slug} item={item} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
