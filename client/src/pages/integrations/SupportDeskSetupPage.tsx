import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import SyncHealthPill from '../../components/support/SyncHealthPill';

interface InboxHealth {
  id: string;
  name: string;
  syncHealth?: 'running' | 'degraded' | 'failed';
  lastSyncAt?: string | null;
  syncErrorMessage?: string | null;
}

type Step = 'choose-provider' | 'connect' | 'confirm';

export default function SupportDeskSetupPage() {
  const [step, setStep] = useState<Step>('choose-provider');
  const [inboxes, setInboxes] = useState<InboxHealth[]>([]);

  useEffect(() => {
    if (step !== 'confirm') return;
    api.get<{ inboxes: InboxHealth[] }>('/api/support/inboxes')
      .then(({ data }) => setInboxes(data.inboxes ?? []))
      .catch(() => { /* non-fatal */ });
  }, [step]);

  if (step === 'choose-provider') {
    return (
      <div className="flex flex-col h-full items-center justify-center px-6">
        <div className="w-full max-w-md">
          <h1 className="text-xl font-semibold text-slate-900 mb-1">Set up Support Desk</h1>
          <p className="text-sm text-slate-500 mb-6">Connect your ticketing provider to get started.</p>

          <div className="mb-6">
            <p className="text-xs font-medium text-slate-700 mb-3 uppercase tracking-wide">Choose provider</p>
            <button
              onClick={() => setStep('connect')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-indigo-500 bg-indigo-50 text-left hover:bg-indigo-100 transition-colors"
            >
              <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-bold">TW</span>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Teamwork</p>
                <p className="text-xs text-slate-500">Connect your Teamwork Desk account</p>
              </div>
            </button>
          </div>

          <button
            onClick={() => setStep('connect')}
            className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (step === 'connect') {
    return (
      <div className="flex flex-col h-full items-center justify-center px-6">
        <div className="w-full max-w-md">
          <h1 className="text-xl font-semibold text-slate-900 mb-1">Connect Teamwork</h1>
          <p className="text-sm text-slate-500 mb-6">Add your Teamwork connection from the Connections page, then return here.</p>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg mb-6 text-sm text-slate-700">
            <p className="font-medium mb-1">How to connect</p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-slate-600">
              <li>Go to the Connections page</li>
              <li>Find Teamwork and click Connect</li>
              <li>Follow the OAuth flow</li>
              <li>Return to this page</li>
            </ol>
          </div>

          <div className="flex gap-2">
            <Link
              to="/connections"
              className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors text-center"
            >
              Go to Connections
            </Link>
            <button
              onClick={() => setStep('confirm')}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Already connected
            </button>
          </div>
          <button
            onClick={() => setStep('choose-provider')}
            className="mt-3 w-full text-xs text-slate-400 hover:text-slate-600"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Support Desk is ready</h1>
        <p className="text-sm text-slate-500 mb-6">Your Teamwork inbox is connected. Configure agent behaviour from the Inboxes page.</p>

        {inboxes.length > 0 && (
          <div className="mb-6 text-left space-y-2">
            {inboxes.map(inbox => (
              <div key={inbox.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded">
                <span className="text-xs text-slate-700 font-medium">{inbox.name}</span>
                {inbox.syncHealth && (
                  <SyncHealthPill
                    health={inbox.syncHealth}
                    lastSyncAt={inbox.lastSyncAt}
                    tooltip={inbox.syncErrorMessage}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 justify-center">
          <Link
            to="/support/inboxes"
            className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Configure inboxes
          </Link>
          <Link
            to="/support/tickets"
            className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            View tickets
          </Link>
        </div>
      </div>
    </div>
  );
}
