// client/src/pages/govern/components/EditWebLoginModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §5.2, §8.12, Chunk 9

import { useState, useEffect } from 'react';
import Modal from '../../../components/Modal';
import api from '../../../lib/api';
import type { WebLoginConnection } from './WebLoginsTab';

interface Props {
  open: boolean;
  subaccountId: string;
  connection: WebLoginConnection;
  onClose: () => void;
  onUpdated: () => void;
}

interface FormState {
  label: string;
  loginUrl: string;
  username: string;
  password: string;
  // Advanced
  contentUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successSelector: string;
  timeoutMs: string;
}

interface FieldErrors {
  label?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
}

function isValidUrl(val: string): boolean {
  try {
    new URL(val);
    return true;
  } catch {
    return false;
  }
}

export function EditWebLoginModal({ open: _open, subaccountId, connection, onClose, onUpdated }: Props) {
  const cfg = connection.config;

  const [form, setForm] = useState<FormState>({
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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

  function set(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setBannerError(null);
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!form.label.trim()) errs.label = 'Label is required.';
    else if (form.label.length > 100) errs.label = 'Label must be 100 characters or fewer.';
    if (!form.loginUrl.trim()) errs.loginUrl = 'Login URL is required.';
    else if (!isValidUrl(form.loginUrl)) errs.loginUrl = 'Enter a valid URL.';
    else if (form.loginUrl.length > 2048) errs.loginUrl = 'URL must be 2048 characters or fewer.';
    if (!form.username.trim()) errs.username = 'Username is required.';
    else if (form.username.length > 256) errs.username = 'Username must be 256 characters or fewer.';
    if (form.password && form.password.length > 2048) errs.password = 'Password must be 2048 characters or fewer.';
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
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
      const axiosErr = e as { response?: { status?: number; data?: { message?: string; error?: string; issues?: Array<{ message: string; path: string[] }> } } };
      if (axiosErr.response?.status === 400 && axiosErr.response.data?.issues) {
        const issues = axiosErr.response.data.issues;
        const newErrs: FieldErrors = {};
        for (const issue of issues) {
          const path = issue.path[0] as keyof FieldErrors | undefined;
          if (path && path in ({} as FieldErrors)) {
            newErrs[path as keyof FieldErrors] = issue.message;
          }
        }
        if (Object.keys(newErrs).length > 0) {
          setFieldErrors(newErrs);
        } else {
          setBannerError(axiosErr.response?.data?.message ?? axiosErr.response?.data?.error ?? 'Validation failed. Check your inputs.');
        }
      } else {
        setBannerError(axiosErr.response?.data?.message ?? axiosErr.response?.data?.error ?? 'Failed to save. Please try again.');
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

        {/* Label */}
        <div className="mb-4">
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
            Label <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="e.g. 42macro.com"
            className={`w-full px-3 py-2 text-[13px] border rounded-lg focus:outline-none focus:ring-1 font-[inherit] ${
              fieldErrors.label
                ? 'border-red-400 focus:border-red-400 focus:ring-red-300'
                : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-400'
            }`}
          />
          {fieldErrors.label && <p className="mt-1 text-[11.5px] text-red-600">{fieldErrors.label}</p>}
        </div>

        {/* Login URL */}
        <div className="mb-4">
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
            Login URL <span className="text-red-500">*</span>
          </label>
          <input
            type="url"
            value={form.loginUrl}
            onChange={(e) => set('loginUrl', e.target.value)}
            placeholder="https://example.com/login"
            className={`w-full px-3 py-2 text-[13px] border rounded-lg focus:outline-none focus:ring-1 font-[inherit] ${
              fieldErrors.loginUrl
                ? 'border-red-400 focus:border-red-400 focus:ring-red-300'
                : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-400'
            }`}
          />
          {fieldErrors.loginUrl && <p className="mt-1 text-[11.5px] text-red-600">{fieldErrors.loginUrl}</p>}
        </div>

        {/* Username */}
        <div className="mb-4">
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
            Username / Email <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.username}
            onChange={(e) => set('username', e.target.value)}
            placeholder="user@example.com"
            className={`w-full px-3 py-2 text-[13px] border rounded-lg focus:outline-none focus:ring-1 font-[inherit] ${
              fieldErrors.username
                ? 'border-red-400 focus:border-red-400 focus:ring-red-300'
                : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-400'
            }`}
          />
          {fieldErrors.username && <p className="mt-1 text-[11.5px] text-red-600">{fieldErrors.username}</p>}
        </div>

        {/* Password */}
        <div className="mb-4">
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
            Password{' '}
            <span className="text-slate-400 text-[12px] font-normal">Leave blank to keep current password</span>
          </label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder="Leave blank to keep current password"
            className={`w-full px-3 py-2 text-[13px] border rounded-lg focus:outline-none focus:ring-1 font-[inherit] ${
              fieldErrors.password
                ? 'border-red-400 focus:border-red-400 focus:ring-red-300'
                : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-400'
            }`}
          />
          {fieldErrors.password && <p className="mt-1 text-[11.5px] text-red-600">{fieldErrors.password}</p>}
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-[12.5px] text-indigo-600 font-medium border-0 bg-transparent cursor-pointer font-[inherit] mb-3 p-0 hover:text-indigo-800 transition-colors"
        >
          <svg
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
            className={`transition-transform duration-150 ${showAdvanced ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          {showAdvanced ? 'Hide advanced' : 'Show advanced'}
        </button>

        {/* Advanced fields */}
        {showAdvanced && (
          <div className="border border-slate-200 rounded-lg p-4 mb-4 space-y-3 bg-slate-50">
            <div>
              <label className="block text-[12.5px] font-medium text-slate-600 mb-1">
                Content URL <span className="text-slate-400 font-normal">(optional: navigate here after login to verify session)</span>
              </label>
              <input
                type="url"
                value={form.contentUrl}
                onChange={(e) => set('contentUrl', e.target.value)}
                placeholder="https://example.com/dashboard"
                className="w-full px-3 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit] bg-white"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-slate-600 mb-1">
                Username selector <span className="text-slate-400 font-normal">(optional CSS selector)</span>
              </label>
              <input
                type="text"
                value={form.usernameSelector}
                onChange={(e) => set('usernameSelector', e.target.value)}
                placeholder="#email"
                className="w-full px-3 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit] bg-white"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-slate-600 mb-1">
                Password selector <span className="text-slate-400 font-normal">(optional CSS selector)</span>
              </label>
              <input
                type="text"
                value={form.passwordSelector}
                onChange={(e) => set('passwordSelector', e.target.value)}
                placeholder="input[type=password]"
                className="w-full px-3 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit] bg-white"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-slate-600 mb-1">
                Submit selector <span className="text-slate-400 font-normal">(optional CSS selector)</span>
              </label>
              <input
                type="text"
                value={form.submitSelector}
                onChange={(e) => set('submitSelector', e.target.value)}
                placeholder="button[type=submit]"
                className="w-full px-3 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit] bg-white"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-slate-600 mb-1">
                Success selector <span className="text-slate-400 font-normal">(optional: element expected after login)</span>
              </label>
              <input
                type="text"
                value={form.successSelector}
                onChange={(e) => set('successSelector', e.target.value)}
                placeholder=".dashboard-header"
                className="w-full px-3 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit] bg-white"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-slate-600 mb-1">
                Timeout (ms) <span className="text-slate-400 font-normal">(optional, 1000-120000)</span>
              </label>
              <input
                type="number"
                value={form.timeoutMs}
                onChange={(e) => set('timeoutMs', e.target.value)}
                placeholder="30000"
                min={1000}
                max={120000}
                className="w-full px-3 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit] bg-white"
              />
            </div>
          </div>
        )}

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
