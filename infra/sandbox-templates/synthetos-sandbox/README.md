# synthetos-sandbox template

Spec B §15.1 — the canonical Docker image for Tier 4 untrusted code execution.
Used by `e2bSandbox` (production/staging) and `localDockerSandbox` (local dev).

## Parity gaps between e2bSandbox and localDockerSandbox (spec §8.2.2)

The `localDockerSandbox` provider runs this same Dockerfile locally via `docker-compose.sandbox.yml`. The image is identical, but there are known behavioural gaps between the two execution environments:

**Network policy.** Local Docker runs with `--network=none` by default. The e2b provider enforces network policy via its own networking layer. Behaviours that depend on egress audit logging (spec §9) can only be exercised end-to-end against `e2bSandbox` — the audit rows are written by the e2b egress hook. Local dev will not produce `sandbox_egress_audit` rows even for tasks with `policy.network.mode = 'allowlist'`.

**Cost enforcement.** `localDockerSandbox` has no real cost. The cost ceiling (`policy.ceilings.maxCostCents`) is a no-op locally — no provider-side enforcement runs. Wall-clock ceiling enforcement remains active via `docker run --stop-timeout` + the worker-side `sandboxCeilingMonitorJob`. Cost rows written locally carry `costCents = 0` and `provider = 'local_docker'`.

**Provider-side telemetry.** Some e2b-specific telemetry fields (`vcpuSeconds`, provider-side `templateVersion` attestation) are populated locally with synthetic values. The telemetry row is written with `provider: 'local_docker'` so operators can distinguish local-dev rows from production rows in queries.

## Template version pinning

`CURRENT_VERSION` declares the intent version and the cost rate. `PUBLISHED_VERSION` is written by CI's attestation workflow after a successful publish. Runtime code reads `PUBLISHED_VERSION.image_digest` to pin per-execution `template_digest`.

To update this template: edit Dockerfile / entrypoint / dependencies, bump `version` in `CURRENT_VERSION`, update `deps_lockfile_hash` to match the new `requirements.txt` + `package-lock.json` concatenation hash, and open a PR. After merge, tag `sandbox-template/synthetos-sandbox/v{version}` against the merge commit to trigger the CI publish job.
