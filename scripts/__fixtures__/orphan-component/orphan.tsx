/**
 * Fixture: orphan.tsx
 *
 * A page component that is NOT referenced via the router, NOT imported
 * by any routed file, and NOT in the allow-list. The analyser SHOULD
 * flag this as a violation (orphan component).
 */
import React from 'react';

export default function OrphanPage() {
  return <div>I am an orphan — nobody imports me</div>;
}
