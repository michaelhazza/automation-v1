// operatorSessionInitialContextBundlerPure.ts — Pure, deterministic trim algorithm
// for the operator session initial-context bundle.
//
// No DB access, no side effects. Same inputs → same outputs (§8.21).
//
// Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md §4.2, §4.3, §5.8, §7

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OperatorSessionInitialContextBundle {
  voice_profile: {
    tone_features: string[];
    style_markers: string[];
    do_not_use: string[];
    canonical_examples: string[];
  } | null;
  memory_blocks: Array<{
    label: string;
    content: string;
    updated_at: string; // ISO8601
  }>;
  owner_identity: {
    timezone: string;        // IANA tz string, e.g. 'Australia/Sydney'
    working_hours: { start: string; end: string } | null;
    recent_activity_summary?: string;
  };
  serialised_size_bytes: number;
}

export interface BundleRawInputs {
  voice_profile: {
    tone_features: string[];
    style_markers: string[];
    do_not_use: string[];
    canonical_examples: string[];
  } | null;
  memory_blocks: Array<{
    label: string;
    content: string;
    updated_at: string;
  }>;
  owner_identity: {
    timezone: string;
    working_hours: { start: string; end: string } | null;
    recent_activity_summary?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HARD_CAP_BYTES = 4096;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the serialised byte length of the bundle including the
 * serialised_size_bytes field. Iterates until the size value is
 * self-consistent (max 2 iterations in practice — digit count only
 * changes once for realistic bundle sizes).
 */
function fullSizeOf(bundle: Omit<OperatorSessionInitialContextBundle, 'serialised_size_bytes'>): number {
  let estimate = 9999; // initial 4-digit placeholder
  for (let i = 0; i < 5; i++) {
    const candidate = { ...bundle, serialised_size_bytes: estimate };
    const actual = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    if (actual === estimate) {
      return actual;
    }
    estimate = actual;
  }
  // Return last estimate — in practice always converges in ≤ 2 iterations.
  return estimate;
}

function withSize(bundle: Omit<OperatorSessionInitialContextBundle, 'serialised_size_bytes'>): OperatorSessionInitialContextBundle {
  const size = fullSizeOf(bundle);
  return { ...bundle, serialised_size_bytes: size };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the trimmed initial-context bundle. Never throws.
 * Trim priority order defined in spec §4.3.
 */
export function buildBundle(inputs: BundleRawInputs): OperatorSessionInitialContextBundle {
  // Step 1: start with the full bundle
  let candidate: Omit<OperatorSessionInitialContextBundle, 'serialised_size_bytes'> = {
    voice_profile: inputs.voice_profile,
    memory_blocks: inputs.memory_blocks,
    owner_identity: inputs.owner_identity,
  };

  if (fullSizeOf(candidate) <= HARD_CAP_BYTES) {
    return withSize(candidate);
  }

  // Step 3: drop canonical_examples
  if (inputs.voice_profile !== null) {
    candidate = {
      ...candidate,
      voice_profile: {
        ...candidate.voice_profile!,
        canonical_examples: [],
      },
    };
  }

  if (fullSizeOf(candidate) <= HARD_CAP_BYTES) {
    return withSize(candidate);
  }

  // Step 4: drop recent_activity_summary
  const ownerWithoutSummary: OperatorSessionInitialContextBundle['owner_identity'] = {
    timezone: candidate.owner_identity.timezone,
    working_hours: candidate.owner_identity.working_hours,
  };
  candidate = { ...candidate, owner_identity: ownerWithoutSummary };

  if (fullSizeOf(candidate) <= HARD_CAP_BYTES) {
    return withSize(candidate);
  }

  // Step 5: drop oldest memory blocks one at a time (arrays are newest-first, pop from end)
  const blocks = [...candidate.memory_blocks];
  while (blocks.length > 0) {
    blocks.pop();
    const withBlocks = { ...candidate, memory_blocks: blocks };
    if (fullSizeOf(withBlocks) <= HARD_CAP_BYTES) {
      return withSize(withBlocks);
    }
  }

  // blocks is now []
  candidate = { ...candidate, memory_blocks: [] };

  // Step 6: drop working_hours
  candidate = {
    ...candidate,
    owner_identity: {
      timezone: candidate.owner_identity.timezone,
      working_hours: null,
    },
  };

  if (fullSizeOf(candidate) <= HARD_CAP_BYTES) {
    return withSize(candidate);
  }

  // Step 7: configuration-error path — trim voice_profile to tone_features + style_markers only
  if (candidate.voice_profile !== null) {
    candidate = {
      ...candidate,
      voice_profile: {
        tone_features: candidate.voice_profile.tone_features,
        style_markers: candidate.voice_profile.style_markers,
        do_not_use: [],
        canonical_examples: [],
      },
    };
  }

  // Return regardless — caller checks isConfigDegraded and logs warn.
  // serialised_size_bytes reflects the actual size of the (possibly over-cap) degraded bundle.
  return withSize(candidate);
}

/**
 * Returns true when voice_profile is non-null but both do_not_use and
 * canonical_examples are empty arrays — proxy for the configuration-error
 * path having fired in buildBundle.
 */
export function isConfigDegraded(bundle: OperatorSessionInitialContextBundle): boolean {
  if (bundle.voice_profile === null) {
    return false;
  }
  return (
    bundle.voice_profile.do_not_use.length === 0 &&
    bundle.voice_profile.canonical_examples.length === 0
  );
}
