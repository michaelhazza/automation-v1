/**
 * Fixture: routed.tsx
 *
 * A page component that IS referenced via lazy(() => import('./routed'))
 * in the test's fake routes file. The analyser should NOT flag this as
 * an orphan.
 */
import React from 'react';

export default function RoutedPage() {
  return <div>I am reachable via the router</div>;
}
