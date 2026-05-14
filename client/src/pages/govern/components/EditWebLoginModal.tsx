// client/src/pages/govern/components/EditWebLoginModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §5.2, §8.12, Chunk 9

import { useState, useEffect } from 'react';
import Modal from '../../../components/Modal';
import api from '../../../lib/api';
import type { WebLoginConnection } from './WebLoginsTab';
import {
  WebLoginPrimaryFields,
  WebLoginAdvancedSection,
  validateWebLoginForm,
  parseWebLoginAxiosError,
  type WebLoginFormState,
  type WebLoginFieldErrors,
} from './_webLoginFormFields';

interface Props {
  open: boolean;
  subaccountId: string;
  connection: WebLoginConnection;
  onClose: () => void;
  onUpdated: () => void;
}

export function EditWebLoginModal({ open: _open, subaccountId, connection, onClose, onUpdated }: Props) {
  const cfg = connection.config;

  const [form, setForm] = useState<WebLoginFormState>({
    label: connection.label ?? '',
    loginUrl: cfg?.loginUrl ?? '',
    username: cfg?.username ?? '',
    password: '',
    contentUrl: cfg?.contentUrl ?? '',
    usernameSelector: cfg?.usernameSelector ?? '',
    passwordSelector: cfg?.passwordSelector ?? '',
    submitSelector: cfg?.submitSelector ?? '',
    successSelector: cfg?.successSelector ?? '',
    timeoutMs: cfg?.timeoutMs != null ? String(cfg.timeoutMs) : '',
  });
  const [fieldErrors, setFieldErrors] = useState<WebLoginFieldErrors>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset form when connection prop changes
  useEffect(() => {
    const c = connection.config;
    setForm({
      label: connection.label ?? '',
      loginUrl: c?.loginUrl ?? '',
      username: c?.username ?? '',
      password: '',
      contentUrl: c?.contentUrl ?? '',
      usernameSelector: c?.usernameSelector ?? '',
      passwordSelector: c?.passwordSelector ?? '',
      submitSelector: c?.submitSelector ?? '',
      successSelector: c?.successSelector ?? '',
      timeoutMs: c?.timeoutMs != null ? String(c.timeoutMs) : '',
    });
    setFieldErrors({});
    setBannerError(null);
  }, [connection.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key: keyof WebLoginFormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setBannerError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateWebLoginForm(form, false);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setBusy(true);
    setBannerError(null);
    try {
      const body: Record<string, unknown> = {};

      if (form.label.trim() !== (connection.label ?? '')) body.label = form.label.trim();

      const configPatch: Record<string, unknown> = {};
      if (form.loginUrl.trim() !== (cfg?.loginUrl ?? '')) configPatch.loginUrl = form.loginUrl.trim();
      if (form.username.trim() !== (cfg?.username ?? '')) configPatch.username = form.username.trim();

      // Optional advanced fields — always send if present (empty string = clear)
      const contentUrlVal = form.contentUrl.trim() || null;
      if (contentUrlVal !== (cfg?.contentUrl ?? null)) configPatch.contentUrl = contentUrlVal;

      const usel = form.usernameSelector.trim() || null;
      if (usel !== (cfg?.usernameSelector ?? null)) configPatch.usernameSelector = usel;

      const psel = form.passwordSelector.trim() || null;
      if (psel !== (cfg?.passwordSelector ?? null)) configPatch.passwordSelector = psel;

      const subsel = form.submitSelector.trim() || null;
      if (subsel !== (cfg?.submitSelector ?? null)) configPatch.submitSelector = subsel;

      const succ = form.successSelector.trim() || null;
      if (succ !== (cfg?.successSelector ?? null)) configPatch.successSelector = succ;

      const tms = form.timeoutMs.trim() ? parseInt(form.timeoutMs, 10) : null;
      if (tms !== (cfg?.timeoutMs ?? null)) configPatch.timeoutMs = tms;

      if (Object.keys(configPatch).length > 0) body.config = configPatch;
      if (form.password) body.password = form.password;

      await api.patch(`/api/subaccounts/${subaccountId}/web-login-connections/${connection.id}`, body);
      onUpdated();
    } catch (e: unknown) {
      const { fieldErrors: fe, bannerMessage } = parseWebLoginAxiosError(e);
      if (Object.keys(fe).length > 0) {
        setFieldErrors(fe);
      } else {
        setBannerError(bannerMessage);
      }
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit Web Login" onClose={onClose} maxWidth={560}>
      <form onSubmit={handleSubmit} noValidate>
        {bannerError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
            {bannerError}
          </div>
        )}

        <WebLoginPrimaryFields
          form={form}
          fieldErrors={fieldErrors}
          passwordLabel={
            <>
              Password{' '}
              <span className="text-slate-400 text-[12px] font-normal">Leave blank to keep current password</span>
            </>
          }
          passwordPlaceholder="Leave blank to keep current password"
          onSet={set}
        />

        <WebLoginAdvancedSection
          form={form}
          show={showAdvanced}
          onToggle={() => setShowAdvanced((v) => !v)}
          onSet={set}
        />

        {/* Actions */}
        <div className="flex justify-between mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer font-[inherit]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white border-0 cursor-pointer font-[inherit] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
