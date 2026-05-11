// client/src/pages/govern/components/ConnectAppModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 8

import { useState } from 'react';
import Modal from '../../../components/Modal';
import api from '../../../lib/api';
import type { AppDefinition } from './AppIntegrationsTab';

// ── Per-app connection variant config ─────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  secret: boolean;
}

interface AppConnectVariant {
  /** CTA button label */
  ctaLabel: string;
  /** For OAuth apps: provider string used to build the auth-url request. For API-key apps: undefined. */
  oauthProvider?: string;
  /** For API-key apps: form fields to render */
  fields: FieldDef[];
  /** Short description shown as modal subtitle */
  subtitle?: string;
}

const APP_CONNECT_VARIANTS: Record<string, AppConnectVariant> = {
  gmail: {
    ctaLabel: 'Continue to Google',
    oauthProvider: 'gmail',
    fields: [],
    subtitle: 'Google Workspace / personal Gmail',
  },
  hubspot: {
    ctaLabel: 'Connect HubSpot',
    fields: [
      {
        key: 'apiKey',
        label: 'HubSpot Private App Token',
        placeholder: 'pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        hint: 'Find this in HubSpot under Settings, Integrations, Private Apps.',
        secret: true,
      },
    ],
    subtitle: 'CRM, contacts, deals and pipeline data',
  },
  slack: {
    ctaLabel: 'Continue to Slack',
    oauthProvider: 'slack',
    fields: [],
    subtitle: 'Team messaging and notifications',
  },
  ghl: {
    ctaLabel: 'Continue to GoHighLevel',
    oauthProvider: 'ghl',
    fields: [],
    subtitle: 'CRM, automations and pipeline',
  },
  teamwork: {
    ctaLabel: 'Continue to Teamwork',
    oauthProvider: 'teamwork',
    fields: [],
    subtitle: 'Project management and tasks',
  },
  google_drive: {
    ctaLabel: 'Continue to Google',
    oauthProvider: 'google_drive',
    fields: [],
    subtitle: 'Files and document storage',
  },
  outlook: {
    ctaLabel: 'Continue to Microsoft',
    oauthProvider: 'outlook',
    fields: [],
    subtitle: 'Email via Microsoft 365',
  },
  microsoft_calendar: {
    ctaLabel: 'Continue to Microsoft',
    oauthProvider: 'microsoft_calendar',
    fields: [],
    subtitle: 'Calendar via Microsoft 365',
  },
  google_calendar: {
    ctaLabel: 'Continue to Google',
    oauthProvider: 'google_calendar',
    fields: [],
    subtitle: 'Calendar via Google Workspace',
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  app: AppDefinition;
  subaccountId: string;
  onClose: () => void;
  onConnected: () => void;
}

export function ConnectAppModal({ app, subaccountId, onClose, onConnected }: Props) {
  const variant = APP_CONNECT_VARIANTS[app.id] ?? {
    ctaLabel: 'Connect',
    oauthProvider: undefined,
    fields: [],
  };

  const isOAuth = Boolean(variant.oauthProvider);

  // Field values keyed by field.key
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldVisible, setFieldVisible] = useState<Record<string, boolean>>({});
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  function toggleFieldVisible(key: string) {
    setFieldVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit() {
    if (isOAuth) {
      setBusy(true);
      setError(null);
      try {
        const params: Record<string, string> = {
          provider: variant.oauthProvider!,
          scope: subaccountId ? 'subaccount' : 'org',
          returnPath: '/connections?tab=app-integrations',
        };
        if (subaccountId) params.subaccountId = subaccountId;
        const { data } = await api.get('/api/integrations/oauth2/auth-url', { params });
        window.location.href = (data as { url: string }).url;
      } catch (e: unknown) {
        const msg = (() => {
          if (e instanceof Error) return e.message;
          const ax = e as { response?: { data?: { message?: string } } };
          return ax.response?.data?.message ?? 'Failed to initiate connection. Please try again.';
        })();
        setError(msg);
        setBusy(false);
      }
      return;
    }

    // API-key flow: validate required fields
    for (const field of variant.fields) {
      if (!fieldValues[field.key]?.trim()) {
        setError(`${field.label} is required.`);
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      // HubSpot (and future API-key providers): POST to subaccount connections endpoint
      const body: Record<string, string> = {
        providerType: app.provider,
        authType: 'api_key',
        label: label.trim() || `${app.name} connection`,
        secretsRef: fieldValues['apiKey'] ?? fieldValues[variant.fields[0]?.key ?? ''] ?? '',
      };
      const response = await api.post(
        `/api/subaccounts/${encodeURIComponent(subaccountId)}/connections`,
        body,
        { validateStatus: (s) => s === 201 },
      );
      if (response.status === 201) {
        onConnected();
      }
    } catch (e: unknown) {
      const msg = (() => {
        if (e instanceof Error) return e.message;
        const ax = e as { response?: { data?: { message?: string } } };
        return ax.response?.data?.message ?? 'Connection failed. Please try again.';
      })();
      setError(msg);
      setBusy(false);
    }
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <Modal title={`Connect ${app.name}`} onClose={onClose} maxWidth={460}>
      {/* App header */}
      <div className="flex items-center gap-3.5 mb-5">
        <div
          className={`w-12 h-12 rounded-xl ${app.avatarBg} flex items-center justify-center flex-shrink-0`}
        >
          <span className={`text-[13px] font-extrabold leading-none ${app.avatarText}`}>{app.abbr}</span>
        </div>
        <div>
          <div className="text-[15px] font-bold text-slate-900 leading-tight">{app.name}</div>
          {variant.subtitle && (
            <div className="text-[12.5px] text-slate-500 mt-0.5">{variant.subtitle}</div>
          )}
        </div>
      </div>

      {/* OAuth description */}
      {isOAuth && (
        <p className="text-[13.5px] text-slate-600 leading-relaxed mb-5">
          Connect your {app.name} account to let agents do work on your behalf. You will be taken to {app.name} to sign in and confirm access.
        </p>
      )}

      {/* API-key fields */}
      {variant.fields.map((field) => (
        <div key={field.key} className="mb-4">
          <label
            htmlFor={`field-${field.key}`}
            className="block text-[12px] font-semibold text-slate-700 mb-1.5"
          >
            {field.label}
          </label>
          <div className="relative">
            <input
              id={`field-${field.key}`}
              type={field.secret && !fieldVisible[field.key] ? 'password' : 'text'}
              value={fieldValues[field.key] ?? ''}
              onChange={(e) => setField(field.key, e.target.value)}
              placeholder={field.placeholder}
              autoComplete="off"
              className="w-full px-3 py-2.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit]"
              style={{ paddingRight: field.secret ? '40px' : undefined }}
            />
            {field.secret && (
              <button
                type="button"
                onClick={() => toggleFieldVisible(field.key)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 bg-transparent border-0 cursor-pointer p-1 rounded font-[inherit]"
                aria-label={fieldVisible[field.key] ? 'Hide' : 'Show'}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
          </div>
          {field.hint && (
            <div className="text-[11px] text-slate-400 mt-1">{field.hint}</div>
          )}
        </div>
      ))}

      {/* Optional label field */}
      <div className="mb-5">
        <label htmlFor="conn-label" className="block text-[12px] font-semibold text-slate-700 mb-1.5">
          Show as <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          id="conn-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`e.g. Marketing ${app.name}`}
          className="w-full px-3 py-2.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit]"
        />
        <div className="text-[11px] text-slate-400 mt-1">
          Useful when you have more than one {app.name} account connected.
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-semibold border-0 cursor-pointer font-[inherit] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Connecting...' : variant.ctaLabel}
        </button>
        {isOAuth && (
          <div className="text-[11.5px] text-slate-400 text-center leading-relaxed">
            {app.name} will ask you to sign in and confirm permissions. You will return here when done.
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full inline-flex items-center justify-center py-2.5 rounded-xl bg-white text-slate-600 border border-slate-200 text-[13px] font-medium hover:border-indigo-300 hover:text-indigo-700 cursor-pointer font-[inherit] transition-all duration-150"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
