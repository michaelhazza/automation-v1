# operator-session template

> ⚠ **DO NOT IMPORT OR EXECUTE THIS TEMPLATE FROM PRODUCTION CODE.**
> The scripts under this directory (`file-watcher.js`, `entrypoint.sh`, `Dockerfile`)
> are placeholder scaffolding and are NOT built, scanned, or published by V1 CI.
> The watcher's IPC contract is documented (metadata-only payload) but the
> host-side bridge that turns those payloads into canonical `handleWatcherEvent`
> calls does NOT exist yet — see backlog item `PA-V2-WATCHER-HOST-BRIDGE`.
> Importing `file-watcher.js` from a built service or running this Dockerfile
> in production will silently drop file events.

Placeholder scaffolding. Real implementation lands with the Operator Backend spec; V1 CI does not build, scan, or publish this template. The `CURRENT_VERSION` file currently contains `version=0.1.0-file-watcher` and will be bumped on each release — once the Operator Backend spec activates this directory, that spec will add the remaining four required fields and extend the `verify-template-version-coherence` gate to include this path.

Promotion to a CI-built artefact is tracked as `PA-V2-OPERATOR-TEMPLATE-PROMOTION` in `tasks/todo.md`.
