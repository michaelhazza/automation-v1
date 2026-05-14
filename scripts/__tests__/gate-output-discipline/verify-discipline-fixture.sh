#!/usr/bin/env bash
# Fixture: deliberately prints AFTER emit_summary to test that parser still works.
GUARD_ID="discipline-fixture"
source "$(dirname "${BASH_SOURCE[0]}")/../../lib/guard-utils.sh"
emit_summary 1 0
echo "This line appears AFTER [GATE] — framework output only"
