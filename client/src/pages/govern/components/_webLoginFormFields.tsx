// client/src/pages/govern/components/_webLoginFormFields.tsx
// Shared primitives for AddWebLoginModal and EditWebLoginModal.

import type React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WebLoginFormState {
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

export interface WebLoginFieldErrors {
  label?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
}

export interface WebLoginAdvancedState {
  contentUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successSelector: string;
  timeoutMs: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

function isValidUrl(val: string): boolean {
  try {
    new URL(val);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a web login form.
 * @param form       The current form state.
 * @param requirePassword  true for Add (password required), false for Edit (blank = keep existing).
 */
export function validateWebLoginForm(
  form: WebLoginFormState,
  requirePassword: boolean,
): WebLoginFieldErrors {
  const errs: WebLoginFieldErrors = {};
  if (!form.label.trim()) errs.label = 'Label is required.';
  else if (form.label.length > 100) errs.label = 'Label must be 100 characters or fewer.';
  if (!form.loginUrl.trim()) errs.loginUrl = 'Login URL is required.';
  else if (!isValidUrl(form.loginUrl)) errs.loginUrl = 'Enter a valid URL.';
  else if (form.loginUrl.length > 2048) errs.loginUrl = 'URL must be 2048 characters or fewer.';
  if (!form.username.trim()) errs.username = 'Username is required.';
  else if (form.username.length > 256) errs.username = 'Username must be 256 characters or fewer.';
  if (requirePassword) {
    if (!form.password) errs.password = 'Password is required.';
    else if (form.password.length > 2048) errs.password = 'Password must be 2048 characters or fewer.';
  } else {
    if (form.password && form.password.length > 2048) errs.password = 'Password must be 2048 characters or fewer.';
  }
  return errs;
}

// ── Server error parsing ──────────────────────────────────────────────────────

const FIELD_KEYS = new Set<keyof WebLoginFieldErrors>(['label', 'loginUrl', 'username', 'password']);

type AxiosLike = {
  response?: {
    status?: number;
    data?: {
      message?: string;
      error?: string;
      issues?: Array<{ message: string; path: string[] }>;
    };
  };
};

interface ParsedAxiosError {
  fieldErrors: WebLoginFieldErrors;
  bannerMessage: string | null;
}

/**
 * Parses a server 400 Axios error into field-level errors + an optional banner.
 * Non-400 errors surface only a banner message.
 */
export function parseWebLoginAxiosError(e: unknown): ParsedAxiosError {
  const axiosErr = e as AxiosLike;
  if (axiosErr.response?.status === 400 && axiosErr.response.data?.issues) {
    const issues = axiosErr.response.data.issues;
    const fieldErrors: WebLoginFieldErrors = {};
    for (const issue of issues) {
      const path = issue.path[0] as string | undefined;
      if (path && FIELD_KEYS.has(path as keyof WebLoginFieldErrors)) {
        fieldErrors[path as keyof WebLoginFieldErrors] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors, bannerMessage: null };
    }
    return {
      fieldErrors: {},
      bannerMessage:
        axiosErr.response?.data?.message ??
        axiosErr.response?.data?.error ??
        'Validation failed. Check your inputs.',
    };
  }
  return {
    fieldErrors: {},
    bannerMessage:
      axiosErr.response?.data?.message ??
      axiosErr.response?.data?.error ??
      'Failed to save. Please try again.',
  };
}

// ── Primary fields component ──────────────────────────────────────────────────

interface PrimaryFieldsProps {
  form: WebLoginFormState;
  fieldErrors: WebLoginFieldErrors;
  passwordLabel?: React.ReactNode;
  passwordPlaceholder?: string;
  onSet: (key: keyof WebLoginFormState, value: string) => void;
}

export function WebLoginPrimaryFields({
  form,
  fieldErrors,
  passwordLabel,
  passwordPlaceholder,
  onSet,
}: PrimaryFieldsProps) {
  return (
    <>
      {/* Label */}
      <div className="mb-4">
        <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
          Label <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={form.label}
          onChange={(e) => onSet('label', e.target.value)}
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
          onChange={(e) => onSet('loginUrl', e.target.value)}
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
          onChange={(e) => onSet('username', e.target.value)}
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
          {passwordLabel ?? <>Password <span className="text-red-500">*</span></>}
        </label>
        <input
          type="password"
          value={form.password}
          onChange={(e) => onSet('password', e.target.value)}
          placeholder={passwordPlaceholder}
          className={`w-full px-3 py-2 text-[13px] border rounded-lg focus:outline-none focus:ring-1 font-[inherit] ${
            fieldErrors.password
              ? 'border-red-400 focus:border-red-400 focus:ring-red-300'
              : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-400'
          }`}
        />
        {fieldErrors.password && <p className="mt-1 text-[11.5px] text-red-600">{fieldErrors.password}</p>}
      </div>
    </>
  );
}

// ── Advanced section component ────────────────────────────────────────────────

interface AdvancedSectionProps {
  form: WebLoginFormState;
  show: boolean;
  onToggle: () => void;
  onSet: (key: keyof WebLoginFormState, value: string) => void;
}

export function WebLoginAdvancedSection({ form, show, onToggle, onSet }: AdvancedSectionProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[12.5px] text-indigo-600 font-medium border-0 bg-transparent cursor-pointer font-[inherit] mb-3 p-0 hover:text-indigo-800 transition-colors"
      >
        <svg
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
          className={`transition-transform duration-150 ${show ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        {show ? 'Hide advanced' : 'Show advanced'}
      </button>

      {show && (
        <div className="border border-slate-200 rounded-lg p-4 mb-4 space-y-3 bg-slate-50">
          <div>
            <label className="block text-[12.5px] font-medium text-slate-600 mb-1">
              Content URL <span className="text-slate-400 font-normal">(optional: navigate here after login to verify session)</span>
            </label>
            <input
              type="url"
              value={form.contentUrl}
              onChange={(e) => onSet('contentUrl', e.target.value)}
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
              onChange={(e) => onSet('usernameSelector', e.target.value)}
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
              onChange={(e) => onSet('passwordSelector', e.target.value)}
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
              onChange={(e) => onSet('submitSelector', e.target.value)}
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
              onChange={(e) => onSet('successSelector', e.target.value)}
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
              onChange={(e) => onSet('timeoutMs', e.target.value)}
              placeholder="30000"
              min={1000}
              max={120000}
              className="w-full px-3 py-2 text-[12.5px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit] bg-white"
            />
          </div>
        </div>
      )}
    </>
  );
}
