#!/bin/bash
# Wrapper script for running tests from the Test Control Center.
# Vitest must be the top-level process (not spawned from another Node process)
# to properly initialize jsdom and other environments.
CONFIG="${1:-vitest.config.ts}"
exec npx vitest run --config "$CONFIG" --reporter=verbose
