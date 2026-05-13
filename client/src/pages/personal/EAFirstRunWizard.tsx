import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

type Step = 'welcome' | 'connect' | 'voice' | 'briefing' | 'confirm';

const STEPS: Step[] = ['welcome', 'connect', 'voice', 'briefing', 'confirm'];

const STEP_LABELS: Record<Step, string> = {
  welcome: 'Welcome',
  connect: 'Connect',
  voice: 'Voice',
  briefing: 'Delivery',
  confirm: 'Confirm',
};

function StepTracker({ current }: { current: Step }) {
  const currentIndex = STEPS.indexOf(current);
  return (
    <div className="flex items-center gap-2 mb-7">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={step} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'bg-indigo-700 text-white'
                      : 'bg-indigo-100 text-indigo-600'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className={`text-xs font-semibold ${
                  active ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="w-8 h-[1.5px] bg-slate-200 flex-shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface CapabilityRowProps {
  icon: string;
  name: string;
  badge: 'required' | 'optional';
  description: string;
  connected: boolean;
  onConnect: () => void;
}

function CapabilityRow({ icon, name, badge, description, connected, onConnect }: CapabilityRowProps) {
  return (
    <div
      className={`flex items-center gap-3 p-4 rounded-xl border mb-2.5 ${
        connected ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-0.5">
          {name}
          <span
            className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${
              badge === 'required'
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-slate-100 text-slate-500 border border-slate-200'
            }`}
          >
            {badge.toUpperCase()}
          </span>
        </div>
        <div className="text-xs text-slate-500 leading-relaxed">{description}</div>
      </div>
      {connected ? (
        <button
          className="flex-shrink-0 px-3 py-2 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold"
          disabled
        >
          Connected
        </button>
      ) : (
        <button
          onClick={onConnect}
          className="flex-shrink-0 px-3 py-2 rounded-lg bg-indigo-700 text-white text-xs font-semibold hover:bg-indigo-800 transition-colors"
        >
          Connect
        </button>
      )}
    </div>
  );
}

export default function EAFirstRunWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [connections, setConnections] = useState({
    gmail: false,
    calendar: false,
    slack: false,
  });
  const [voiceOptIn, setVoiceOptIn] = useState(false);
  const [briefingDelivery, setBriefingDelivery] = useState<'slack_dm' | 'email'>('slack_dm');
  const [briefingTime, setBriefingTime] = useState('07:00');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function goNext() {
    const nextIndex = STEPS.indexOf(step) + 1;
    if (nextIndex < STEPS.length) {
      setStep(STEPS[nextIndex]);
    }
  }

  function goBack() {
    const prevIndex = STEPS.indexOf(step) - 1;
    if (prevIndex >= 0) {
      setStep(STEPS[prevIndex]);
    }
  }

  function handleConnect(provider: keyof typeof connections) {
    // Redirect to OAuth flow; connection state will be reflected on return.
    // For now mark as connected in UI (real OAuth handled by /connections).
    setConnections((prev) => ({ ...prev, [provider]: true }));
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.post<{ agentId: string }>('/api/personal/setup', {
        voiceProfileOptIn: voiceOptIn,
        briefingDeliveryTarget: briefingDelivery,
        briefingTimeUtc: briefingTime,
      });
      navigate(`/personal/${res.data.agentId}`, { replace: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setSubmitError(message);
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="max-w-2xl mx-auto w-full px-6 py-10 flex-1">
        <div className="mb-6">
          <div className="text-[11px] font-bold tracking-widest uppercase text-indigo-600 mb-2">
            Personal Assistant Setup
          </div>
          <h1 className="text-[26px] font-bold text-slate-900 tracking-tight mb-1.5">
            Get your Personal Assistant ready
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed max-w-lg">
            Connect the tools your assistant will use, then tell it how to write for you. Takes about 2 minutes.
          </p>
        </div>

        <StepTracker current={step} />

        {step === 'welcome' && (
          <div className="bg-white border border-slate-200 rounded-xl p-7">
            <h2 className="text-base font-bold text-slate-900 mb-2">
              Your AI assistant, personalised to you
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">
              Your Personal Assistant manages your calendar, drafts messages in your voice, and keeps you briefed every morning. It only sends on your behalf after you approve.
            </p>
            <ul className="space-y-2 mb-6">
              {[
                'Drafts email replies and calendar responses for your review',
                'Posts Slack messages only to direct conversations unless you change this',
                'Sends a morning briefing to your preferred channel',
                'Learns your writing style over time (with your permission)',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="text-emerald-500 font-bold mt-0.5 flex-shrink-0">+</span>
                  {item}
                </li>
              ))}
            </ul>
            <button
              onClick={goNext}
              className="w-full py-2.5 bg-indigo-700 text-white rounded-lg font-semibold text-sm hover:bg-indigo-800 transition-colors"
            >
              Get started
            </button>
          </div>
        )}

        {step === 'connect' && (
          <div className="bg-white border border-slate-200 rounded-xl p-7">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Connect your accounts
            </h2>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              Pick the tools your assistant can access. You control what it can send before it goes out.
            </p>

            <CapabilityRow
              icon="G"
              name="Gmail"
              badge="required"
              description="Drafts email replies in your voice. All sends require your approval."
              connected={connections.gmail}
              onConnect={() => handleConnect('gmail')}
            />
            <CapabilityRow
              icon="C"
              name="Google Calendar"
              badge="required"
              description="Reads your schedule and responds to invites. Calendar changes require your approval."
              connected={connections.calendar}
              onConnect={() => handleConnect('calendar')}
            />
            <CapabilityRow
              icon="S"
              name="Slack"
              badge="optional"
              description="Posts DMs in your name automatically. All other sends require your approval."
              connected={connections.slack}
              onConnect={() => handleConnect('slack')}
            />
          </div>
        )}

        {step === 'voice' && (
          <div className="bg-white border border-slate-200 rounded-xl p-7">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Writing style
            </h2>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              Your assistant can analyse a sample of messages you have already sent to match your tone. This is optional and you can opt out at any time.
            </p>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <p className="text-sm text-slate-700 leading-relaxed mb-4">
                Analyse my sent messages to personalise how my assistant writes. Samples are never stored and are deleted after analysis.
              </p>
              <div className="flex items-center gap-3">
                <button
                  role="switch"
                  aria-checked={voiceOptIn}
                  onClick={() => setVoiceOptIn((v) => !v)}
                  className={`relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0 ${
                    voiceOptIn ? 'bg-indigo-700' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-[2px] w-3.5 h-3.5 bg-white rounded-full transition-all ${
                      voiceOptIn ? 'right-[2px]' : 'left-[2px]'
                    }`}
                  />
                </button>
                <span className="text-sm text-slate-700 font-medium">
                  {voiceOptIn ? 'Enabled' : 'Not enabled'}
                </span>
              </div>
            </div>
          </div>
        )}

        {step === 'briefing' && (
          <div className="bg-white border border-slate-200 rounded-xl p-7">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Morning briefing
            </h2>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              Your assistant sends a short briefing each morning with what you need to know for the day.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Briefing time
                </label>
                <input
                  type="time"
                  value={briefingTime}
                  onChange={(e) => setBriefingTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Delivery
                </label>
                <select
                  value={briefingDelivery}
                  onChange={(e) => setBriefingDelivery(e.target.value as 'slack_dm' | 'email')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
                >
                  <option value="slack_dm">Slack DM (recommended)</option>
                  <option value="email">Email</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="bg-white border border-slate-200 rounded-xl p-7">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Ready to activate
            </h2>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              Review your setup below, then confirm to activate your Personal Assistant.
            </p>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                <span className="text-slate-500">Connections</span>
                <span className="text-slate-900 font-medium">
                  {[
                    connections.gmail && 'Gmail',
                    connections.calendar && 'Google Calendar',
                    connections.slack && 'Slack',
                  ]
                    .filter(Boolean)
                    .join(', ') || 'None connected'}
                </span>
              </div>
              <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                <span className="text-slate-500">Writing style analysis</span>
                <span className="text-slate-900 font-medium">{voiceOptIn ? 'Enabled' : 'Not enabled'}</span>
              </div>
              <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                <span className="text-slate-500">Briefing time</span>
                <span className="text-slate-900 font-medium">{briefingTime}</span>
              </div>
              <div className="flex justify-between text-sm py-2">
                <span className="text-slate-500">Briefing delivery</span>
                <span className="text-slate-900 font-medium">
                  {briefingDelivery === 'slack_dm' ? 'Slack DM' : 'Email'}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Slack DMs to you are sent automatically. All other sends require your approval.
            </p>

            {submitError && (
              <div className="mb-4 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
                {submitError}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full py-2.5 bg-indigo-700 text-white rounded-lg font-semibold text-sm hover:bg-indigo-800 transition-colors disabled:opacity-60"
            >
              {isSubmitting ? 'Setting up…' : 'Activate Personal Assistant'}
            </button>
          </div>
        )}

        <div className="flex justify-between items-center mt-6 pt-5 border-t border-slate-200">
          {step !== 'welcome' ? (
            <button
              onClick={goBack}
              className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-500 hover:border-slate-300 transition-colors"
            >
              Back
            </button>
          ) : (
            <div />
          )}

          {step !== 'confirm' && (
            <button
              onClick={goNext}
              className="px-5 py-2 bg-indigo-700 text-white rounded-lg text-sm font-bold hover:bg-indigo-800 transition-colors"
            >
              {step === 'welcome' ? 'Get started' : 'Continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
