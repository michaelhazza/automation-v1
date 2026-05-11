// ---------------------------------------------------------------------------
// Operator Session Identity — Provider Capability Registry
//
// Canonical registry of providers supported for operator-session auth.
// Each entry describes the connection mechanism, plan detection approach,
// refresh/revocation capabilities, and which tiers are sanctioned for
// runtime use vs opt-in only.
//
// Spec: docs/operator-session-identity-spec.md §10.2, §10.3
// ---------------------------------------------------------------------------

export type ProviderCapabilityEntry = {
  displayName: string;
  connectionMechanism: 'oauth_pkce' | 'device_flow' | 'api_key' | 'none_verified';
  planDetectionMechanism: 'introspection_api' | 'probe' | 'self_declaration' | 'none';
  refreshSupport: boolean;
  revocationSignalSupport: 'push_event' | 'poll' | 'none';
  runtimeUseEnabled: boolean;
  sanctionedTiers: Array<'pro' | 'team' | 'enterprise'>;
  optInTiers: Array<'plus'>;
};

export const OPERATOR_SESSION_PROVIDERS: Record<string, ProviderCapabilityEntry> = {
  openai: {
    displayName: 'OpenAI / ChatGPT',
    connectionMechanism: 'none_verified',
    planDetectionMechanism: 'self_declaration',
    refreshSupport: true,
    revocationSignalSupport: 'none',
    runtimeUseEnabled: false,
    sanctionedTiers: ['pro', 'team', 'enterprise'],
    optInTiers: ['plus'],
  },
};

export const OPERATOR_SESSION_DISCLOSURE_VERSION = 1;
