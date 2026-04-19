-- 0170_clientpulse_template_extension.sql
-- ClientPulse Phase 0: extend the GHL Agency Intelligence system template's
-- operational_defaults with 5 new config blocks required for Staff Activity
-- Pulse (§2.0b), Integration Fingerprint Scanner (§2.0c), intervention
-- defaults, churn band thresholds, and onboarding milestone definitions.
--
-- Spec: tasks/clientpulse-ghl-gap-analysis.md §12.2 Gap A
-- Adds keys: staffActivity, integrationFingerprints, interventionDefaults,
--           churnBands, onboardingMilestones
-- Existing keys preserved via jsonb `||` merge (later-wins on key conflict;
-- none of these 5 keys exist on the template today per audit).

BEGIN;

UPDATE system_hierarchy_templates
SET operational_defaults = operational_defaults || '{
  "staffActivity": {
    "countedMutationTypes": [
      { "type": "contact_created",           "weight": 1.0 },
      { "type": "contact_updated",           "weight": 0.5 },
      { "type": "opportunity_stage_changed", "weight": 2.0 },
      { "type": "opportunity_status_changed","weight": 1.5 },
      { "type": "message_sent_outbound",     "weight": 1.5 },
      { "type": "note_added",                "weight": 1.0 },
      { "type": "task_completed",            "weight": 1.0 },
      { "type": "workflow_edited",           "weight": 3.0 },
      { "type": "funnel_edited",             "weight": 3.0 },
      { "type": "calendar_configured",       "weight": 2.0 }
    ],
    "excludedUserKinds": ["automation", "contact", "unknown"],
    "automationUserResolution": {
      "strategy": "outlier_by_volume",
      "threshold": 0.6,
      "cacheMonths": 1
    },
    "lookbackWindowsDays": [7, 30, 90],
    "churnFlagThresholds": {
      "zeroActivityDays": 14,
      "weekOverWeekDropPct": 50
    }
  },
  "integrationFingerprints": {
    "seedLibrary": [
      {
        "integrationSlug": "closebot",
        "displayName": "CloseBot",
        "vendorUrl": "https://closebot.ai",
        "fingerprints": [
          { "type": "conversation_provider_id", "valuePattern": "^closebot:" },
          { "type": "workflow_action_type",     "valuePattern": "^closebot\\." },
          { "type": "outbound_webhook_domain",  "value":        "api.closebot.ai" },
          { "type": "custom_field_prefix",      "valuePattern": "^closebot_" },
          { "type": "tag_prefix",               "valuePattern": "^closebot:" }
        ],
        "confidence": 0.95
      }
    ],
    "scanFingerprintTypes": [
      "conversation_provider_id",
      "workflow_action_type",
      "outbound_webhook_domain",
      "custom_field_prefix",
      "tag_prefix",
      "contact_source"
    ],
    "unclassifiedSignalPromotion": {
      "surfaceAfterOccurrenceCount": 50,
      "surfaceAfterSubaccountCount": 3
    }
  },
  "interventionDefaults": {
    "cooldownHours": 48,
    "cooldownScope": "executed",
    "defaultGateLevel": "review",
    "maxProposalsPerDayPerSubaccount": 1,
    "maxProposalsPerDayPerOrg": 20
  },
  "churnBands": {
    "healthy":  [70, 100],
    "watch":    [40, 69],
    "atRisk":   [20, 39],
    "critical": [0, 19]
  },
  "onboardingMilestones": []
}'::jsonb
WHERE slug = 'ghl-agency-intelligence';

COMMIT;
