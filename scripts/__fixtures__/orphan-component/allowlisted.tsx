/**
 * Fixture: allowlisted.tsx
 *
 * A page component that is NOT referenced via the router AND is NOT
 * imported by any routed file, but IS listed in the allow-list fixture.
 * The analyser should NOT flag this as an orphan.
 */
import React from 'react';

export default function AllowlistedPage() {
  return <div>I am intentionally not routed (allow-listed)</div>;
}
