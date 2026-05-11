// client/src/pages/govern/components/AddWebLoginModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §5.2, §8.12, Chunk 9

import { useState } from 'react';
import Modal from '../../../components/Modal';
import api from '../../../lib/api';
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
  onClose: () => void;
  onCreated: () => void;
}

const EMPTY_FORM: WebLoginFormState = {
  label: '',
  loginUrl: '',
  username: '',
  password: '',
  contentUrl: '',
  usernameSelector: '',
  passwordSelector: '',
  submitSelector: '',
  successSelector: '',
  timeoutMs: '',
};

export function AddWebLoginModal({ open: _open, subaccountId, onClose, onCreated }: Props) {
  const [form, setForm] = useState<WebLoginFormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<WebLoginFieldErrors>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  function set(key: keyof WebLoginFormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setBannerError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateWebLoginForm(form, true);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setBusy(true);
    setBannerError(null);
    try {
      const config: Record<string, unknown> = {
        loginUrl: form.loginUrl.trim(),
        username: form.username.trim(),
      };
      if (form.contentUrl.trim()) config.contentUrl = form.contentUrl.trim();
      if (form.usernameSelector.trim()) config.usernameSelector = form.usernameSelector.trim();
      if (form.passwordSelector.trim()) config.passwordSelector = form.passwordSelector.trim();
      if (form.submitSelector.trim()) config.submitSelector = form.submitSelector.trim();
      if (form.successSelector.trim()) config.successSelector = form.successSelector.trim();
      if (form.timeoutMs.trim()) {
        const t = parseInt(form.timeoutMs, 10);
        if (!isNaN(t)) config.timeoutMs = t;
      }
      // V1: displayName not surfaced in form; server defaults it to label.
      await api.post(`/api/subaccounts/${subaccountId}/web-login-connections`, {
        label: form.label.trim(),
        config,
        password: form.password,
      });
      onCreated();
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
    <Modal title="Add Web Login" onClose={onClose} maxWidth={560}>
      <form onSubmit={handleSubmit} noValidate>
        {bannerError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
            {bannerError}
          </div>
        )}

        <WebLoginPrimaryFields
          form={form}
          fieldErrors={fieldErrors}
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
            {busy ? 'Saving...' : 'Add Web Login'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
