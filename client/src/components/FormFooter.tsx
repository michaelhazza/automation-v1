/**
 * FormFooter — fixed bottom action bar for form pages.
 *
 * Pages using `<FormFooter>` MUST be wrapped in `<PageShell bottomPadding={100}>` (or larger).
 * Without it, the last form field is visually clipped behind the footer.
 * `<FormFooter>` does NOT inject a spacer div.
 *
 * Padding model: horizontal padding lives on `.form-footer-inner`, NOT on `.form-footer`.
 * This ensures the button group aligns with the form card edges.
 *
 * @example
 * <PageShell bottomPadding={100}>
 *   <form>...</form>
 *   <FormFooter>
 *     <button className="btn btn-secondary">Discard</button>
 *     <button className="btn btn-primary">Save</button>
 *   </FormFooter>
 * </PageShell>
 */

import React from 'react';

interface FormFooterProps {
  /** Max-width of the inner button container. Default: 720. */
  innerMaxWidth?: number;
  /** Typically <Discard /> <Save /> <Delete /> */
  children: React.ReactNode;
}

export function FormFooter({ innerMaxWidth = 720, children }: FormFooterProps) {
  return (
    <div className="form-footer">
      <div
        className="form-footer-inner"
        style={innerMaxWidth !== 720 ? { maxWidth: innerMaxWidth } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
