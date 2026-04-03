import { useEffect, useState, useRef, useCallback } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

interface TestFile {
  name: string;
  status: 'passed' | 'failed';
  duration: number;
  tests: TestResult[];
}

interface TestRun {
  id: string;
  suite: 'server' | 'client';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'passed' | 'failed';
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  testFiles: TestFile[];
}

interface LiveTest {
  file: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
}

const STATUS_CLS: Record<string, string> = {
  passed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-500',
  running: 'bg-blue-100 text-blue-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_CLS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'passed') return <span className="text-green-500 text-sm font-bold">&#10003;</span>;
  if (status === 'failed') return <span className="text-red-500 text-sm font-bold">&#10007;</span>;
  return <span className="text-slate-400 text-sm">&#8211;</span>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function SystemTestsPage({ user }: { user: User }) {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [activeRun, setActiveRun] = useState<TestRun | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Live streaming state
  const [liveTests, setLiveTests] = useState<LiveTest[]>([]);
  const [livePhase, setLivePhase] = useState<string>('');
  const [liveSummary, setLiveSummary] = useState<string[]>([]);
  const liveEndRef = useRef<HTMLDivElement>(null);

  const loadRuns = async () => {
    try {
      const { data } = await api.get('/api/system/tests/runs');
      setRuns(data);
    } catch {
      setError('Failed to load test runs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRuns(); }, []);

  // Auto-scroll live feed
  useEffect(() => {
    liveEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveTests]);

  const runTests = useCallback((suite: 'server' | 'client') => {
    setRunning(suite);
    setError('');
    setActiveRun(null);
    setLiveTests([]);
    setLivePhase('starting');
    setLiveSummary([]);

    const token = localStorage.getItem('token');
    const evtSource = new EventSource(
      `/api/system/tests/run-stream?suite=${suite}&token=${token}`
    );

    evtSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setLivePhase(data.phase);
    });

    evtSource.addEventListener('test', (e) => {
      const data = JSON.parse(e.data) as LiveTest;
      setLiveTests(prev => [...prev, data]);
      setLivePhase('running');
    });

    evtSource.addEventListener('summary', (e) => {
      const data = JSON.parse(e.data);
      setLiveSummary(prev => [...prev, data.line]);
    });

    evtSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data) as TestRun;
      setActiveRun(data);
      setExpandedFiles(new Set(data.testFiles.filter(f => f.status === 'failed').map(f => f.name)));
      setRunning(null);
      setLivePhase('complete');
      evtSource.close();
      loadRuns();
    });

    evtSource.addEventListener('error_event', (e) => {
      const data = JSON.parse(e.data);
      setError(data.message);
      setRunning(null);
      setLivePhase('');
      evtSource.close();
    });

    evtSource.onerror = () => {
      // SSE reconnect or actual error — close and show what we have
      if (running) {
        setRunning(null);
        setLivePhase('');
      }
      evtSource.close();
    };
  }, []);

  const viewRun = async (id: string) => {
    setLiveTests([]);
    setLivePhase('');
    setLiveSummary([]);
    try {
      const { data } = await api.get(`/api/system/tests/runs/${id}`);
      setActiveRun(data);
      setExpandedFiles(new Set(data.testFiles.filter((f: TestFile) => f.status === 'failed').map((f: TestFile) => f.name)));
    } catch {
      setError('Failed to load test run');
    }
  };

  const toggleFile = (name: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const expandAll = () => {
    if (activeRun) setExpandedFiles(new Set(activeRun.testFiles.map(f => f.name)));
  };

  const collapseAll = () => setExpandedFiles(new Set());

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading...</div>;
  }

  // Group live tests by file
  const liveFileMap = new Map<string, LiveTest[]>();
  for (const t of liveTests) {
    if (!liveFileMap.has(t.file)) liveFileMap.set(t.file, []);
    liveFileMap.get(t.file)!.push(t);
  }

  const livePassCount = liveTests.filter(t => t.status === 'passed').length;
  const liveFailCount = liveTests.filter(t => t.status === 'failed').length;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0 mb-1.5">Test Control Center</h1>
          <p className="text-slate-500 m-0 text-[14px]">Run and review automated test suites</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => runTests('all' as any)}
            disabled={running !== null}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-[0_1px_4px_rgba(99,102,241,0.35)] hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Running...</>
            ) : (
              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Run All Tests</>
            )}
          </button>
          <button
            onClick={() => runTests('server')}
            disabled={running !== null}
            className="inline-flex items-center gap-2 px-3 py-2.5 text-[13px] font-semibold rounded-lg border border-slate-200 cursor-pointer transition-all duration-150 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Server Only
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-[13px] mb-5">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[1fr_320px] gap-5">
        {/* Main content */}
        <div>
          {/* Live streaming feed */}
          {running && (
            <div className="bg-slate-900 rounded-xl overflow-hidden mb-5">
              <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[13px] font-semibold text-white">
                    Running {running === 'server' ? 'Server' : 'Client'} Tests
                  </span>
                </div>
                <div className="flex gap-4 text-[12px]">
                  <span className="text-green-400">{livePassCount} passed</span>
                  {liveFailCount > 0 && <span className="text-red-400">{liveFailCount} failed</span>}
                  <span className="text-slate-500">{liveTests.length} total</span>
                </div>
              </div>
              <div className="max-h-[400px] overflow-y-auto px-4 py-2 font-mono text-[12px]">
                {Array.from(liveFileMap.entries()).map(([file, tests]) => (
                  <div key={file} className="mb-2">
                    <div className="text-slate-500 text-[11px] mb-0.5">{file.split('/').slice(-1)[0]}</div>
                    {tests.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 py-0.5 pl-3">
                        {t.status === 'passed' && <span className="text-green-400">✓</span>}
                        {t.status === 'failed' && <span className="text-red-400">✗</span>}
                        {t.status === 'skipped' && <span className="text-slate-600">–</span>}
                        <span className={t.status === 'failed' ? 'text-red-300' : 'text-slate-300'}>{t.name}</span>
                        <span className="text-slate-600 ml-auto">{t.duration}ms</span>
                      </div>
                    ))}
                  </div>
                ))}
                {liveSummary.map((line, i) => (
                  <div key={`s-${i}`} className="text-slate-400 mt-1">{line}</div>
                ))}
                <div ref={liveEndRef} />
              </div>
            </div>
          )}

          {/* Completed run results */}
          {activeRun && !running ? (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Summary bar */}
              <div className={`px-5 py-4 border-b ${activeRun.status === 'passed' ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={activeRun.status} />
                    <span className="text-[13px] font-semibold text-slate-700">
                      {activeRun.suite === 'server' ? 'Server' : 'Client'} Tests — {activeRun.testFiles.length} files
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={expandAll} className="text-[11px] text-slate-500 hover:text-slate-700 bg-transparent border-0 cursor-pointer">Expand all</button>
                    <button onClick={collapseAll} className="text-[11px] text-slate-500 hover:text-slate-700 bg-transparent border-0 cursor-pointer">Collapse</button>
                    <span className="text-[12px] text-slate-500">{formatTime(activeRun.startedAt)}</span>
                  </div>
                </div>
                <div className="flex gap-6 text-[13px]">
                  <span className="text-green-700 font-semibold">{activeRun.passedTests} passed</span>
                  {activeRun.failedTests > 0 && <span className="text-red-700 font-semibold">{activeRun.failedTests} failed</span>}
                  {activeRun.skippedTests > 0 && <span className="text-slate-500">{activeRun.skippedTests} skipped</span>}
                  <span className="text-slate-500">{formatDuration(activeRun.durationMs)}</span>
                </div>
              </div>

              {/* Test files */}
              <div className="divide-y divide-slate-100">
                {activeRun.testFiles.map(file => (
                  <div key={file.name}>
                    <button
                      onClick={() => toggleFile(file.name)}
                      className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors border-0 bg-transparent cursor-pointer"
                    >
                      <svg
                        className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expandedFiles.has(file.name) ? 'rotate-90' : ''}`}
                        fill="currentColor" viewBox="0 0 20 20"
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className={`w-2 h-2 rounded-full ${file.status === 'passed' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-[13px] font-medium text-slate-700 flex-1 font-mono">
                        {file.name.split('/').slice(-1)[0]}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">{file.tests.length} tests</span>
                      <span className="text-[11px] text-slate-400">{file.duration}ms</span>
                    </button>

                    {expandedFiles.has(file.name) && (
                      <div className="pl-14 pr-5 pb-3">
                        <div className="text-[11px] text-slate-400 mb-2 font-mono">{file.name}</div>
                        {file.tests.map((test, i) => (
                          <div key={i} className="flex items-start gap-2.5 py-1.5">
                            <StatusIcon status={test.status} />
                            <div className="flex-1">
                              <span className={`text-[12px] ${test.status === 'failed' ? 'text-red-700 font-medium' : 'text-slate-600'}`}>
                                {test.name}
                              </span>
                              {test.error && (
                                <pre className="mt-1 text-[11px] text-red-600 bg-red-50 px-3 py-2 rounded-md overflow-x-auto whitespace-pre-wrap font-mono">
                                  {test.error}
                                </pre>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 shrink-0">{test.duration}ms</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : !running ? (
            <div className="bg-white border border-slate-200 rounded-xl px-8 py-16 text-center">
              <div className="text-slate-300 mb-4">
                <svg className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-1">No test run selected</h3>
              <p className="text-[13px] text-slate-500 mb-6">Run a test suite or select a previous run from the sidebar</p>
            </div>
          ) : null}
        </div>

        {/* Sidebar — run history */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="text-[13px] font-semibold text-slate-700 m-0">Run History</h3>
          </div>
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
            {runs.length === 0 ? (
              <p className="text-[13px] text-slate-400 text-center py-8">No runs yet</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {runs.map(run => (
                  <button
                    key={run.id}
                    onClick={() => viewRun(run.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors border-0 cursor-pointer ${
                      activeRun?.id === run.id ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'bg-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={run.status} />
                      <span className="text-[12px] font-medium text-slate-600">
                        {run.suite === 'server' ? 'Server' : 'Client'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex gap-3">
                      <span>{run.passedTests}/{run.totalTests} passed</span>
                      <span>{formatDuration(run.durationMs)}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {formatTime(run.startedAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
