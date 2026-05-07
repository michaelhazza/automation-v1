/**
 * PageShell — page-level layout wrapper.
 *
 * Provides a flex column shell with an optional header slot and a scrollable
 * content area. Constrains content to `maxWidth` (default 1280px) and centres
 * it horizontally.
 *
 * Use `bottomPadding={100}` (or larger) when a `<FormFooter>` is present so
 * the footer does not clip the last form field.
 *
 * @example
 * // Standard page
 * <PageShell header={<PageHeader title="Settings" />}>
 *   <SettingsForm />
 * </PageShell>
 *
 * @example
 * // Page with FormFooter
 * <PageShell header={<PageHeader title="Edit pipeline" />} bottomPadding={100}>
 *   <PipelineForm />
 *   <FormFooter>...</FormFooter>
 * </PageShell>
 */

import React from 'react';

interface PageShellProps {
  /** Optional header node rendered above the scrollable content area. */
  header?: React.ReactNode;
  /** Page body content. */
  children: React.ReactNode;
  /**
   * Extra bottom padding (px) added to the content wrapper.
   * Use 100+ when a `<FormFooter>` is present to prevent field clipping.
   * Omit (undefined) for no extra padding.
   */
  bottomPadding?: number;
  /**
   * Max-width of the content column (px). Default: 1280.
   * Applied via inline style so callers can override without a CSS change.
   */
  maxWidth?: number;
}

export function PageShell({
  header,
  children,
  bottomPadding,
  maxWidth = 1280,
}: PageShellProps) {
  const contentStyle: React.CSSProperties = {
    maxWidth,
    ...(bottomPadding !== undefined ? { paddingBottom: bottomPadding } : {}),
  };

  return (
    <div className="page-shell">
      {header}
      <div className="page-content" style={contentStyle}>
        {children}
      </div>
    </div>
  );
}
