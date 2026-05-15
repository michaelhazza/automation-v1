// ---------------------------------------------------------------------------
// resolveMigrationAdapter — inline helper for workspace.migrate-identity worker
// ---------------------------------------------------------------------------

export async function resolveMigrationAdapter(backend: string) {
  if (backend === 'synthetos_native') {
    const { nativeWorkspaceAdapter } = await import('../../adapters/workspace/nativeWorkspaceAdapter.js');
    return nativeWorkspaceAdapter;
  }
  if (backend === 'google_workspace') {
    const { googleWorkspaceAdapter } = await import('../../adapters/workspace/googleWorkspaceAdapter.js');
    return googleWorkspaceAdapter;
  }
  throw new Error(`unknown migration backend: ${backend}`);
}
