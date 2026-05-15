# REQ #57 — credential value-threading deferred to v2

**Date:** 2026-05-15
**Build:** sandbox-safety-batch
**Status:** v2-deferred
**Owner:** main-session (claude opus 4.7)

## Decision

REQ #57 (credential value-threading into `/workspace/secrets/`) is deferred to v2-backlog. It waits on the e2b SDK install.

## Rationale

- The e2b SDK is not installed in V1 per `SANDBOX-DEF-EGRESS-MECH` and the sandbox-isolation spec §3 non-goal.
- Current stub at `server/services/sandbox/e2bSandbox.ts` (lines 297-313) declares what the file write SHOULD do but cannot execute it without the SDK's file-write API. The loop at lines 306-313 iterates each credential alias and computes `targetPath = credentialAliasPath(alias.alias)` but the `sdkClient.writeFile(...)` call is commented out with `// When available:` because the credential VALUE is not threaded through in V1.
- The upstream `CredentialBrokerService` (from spec C `operator-session-identity`) is the canonical issuer; integration plugs in when the SDK lands.

## Trigger to revisit

When the e2b SDK is installed (next sandbox build, post-v1):
1. Replace the stub at `server/services/sandbox/e2bSandbox.ts` with the SDK's file-write call.
2. Thread `credentialAliases` from `sandbox_executions.credential_aliases` (added in this build's chunk 1b) into the per-alias file write.
3. Verify each alias's value is sourced from the broker, not the env var.
4. Add an integration test covering the end-to-end alias-to-file path.

## Out of scope this build

- No code changes related to REQ #57 in this build.
- The `credential_aliases` JSONB column added by chunk 1b is the schema foundation that REQ #57 will read from in v2.
