# Stub: Sandbox isolation MVP — critical-path completion

**Trigger to activate:** Before any real Tier 4 untrusted code first runs in the sandbox primitive (e2b account provisioning is the natural trigger).

**Scope (one paragraph).** Close the critical-path gaps that prevent sandbox-isolation from working end-to-end on the happy path. Consolidate: REQ #11 (`runTask` does not call `runHarvest`), REQ #28 (`sandbox_start_failed` telemetry never emitted), REQ #29 (`sandbox_start` telemetry never emitted), REQ #6 (`sandbox_logs.line` length CHECK constraint), REQ #20 (`sandboxMeteringQueryPure.ts` missing), REQ #31 (withSandboxProvider DB-row telemetry), REQ #35 (artefact purge trigger from soft-delete), REQ #36 (ceiling-monitor + wall-clock-kill provider terminate), REQ #55 (teardown verification), REQ #57 (credential value-threading); plus the confirmed-hole adversarial findings SANDBOX-ADV-1.1 (reconciliation `withOrgTx`), SANDBOX-ADV-4.1 (case-sensitive credential-leak defense), and SANDBOX-ADV-5.1 (ceiling-monitor + wall-clock-kill jobs never enqueued). One coherent "make sandbox actually work end-to-end" build.

**Origin:** Sandbox-isolation deferred items in legacy `tasks/todo.md`.
