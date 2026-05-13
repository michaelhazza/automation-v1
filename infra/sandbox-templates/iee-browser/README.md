# iee-browser sandbox template

Playwright-backed IEE browser execution template for e2b sandboxes.

## Overview

Runs the IEE browser executor inside an e2b sandbox. The harness:
1. Reads the task payload from `/workspace/input.json`
2. Mounts the browser profile volume at `profileMount.userDataDirInSandbox` (default: `/workspace/profile`)
3. Executes the browser actions using Playwright
4. Writes output to `/workspace/output.json` and artefacts to `/workspace/artefacts`

## Version pinning

`CURRENT_VERSION` and `PUBLISHED_VERSION` are managed by the CI sandbox-template-build pipeline.
Update `base_image_digest` and `deps_lockfile_hash` in `CURRENT_VERSION` when bumping dependencies.

## Template name

`iee-browser` — referenced by `server/services/sandbox/e2bSandbox.ts` when `sandboxRequirement === 'browser'`.
