-- Portfolio Health Agent: system agent for org-level portfolio monitoring
INSERT INTO system_agents (
  id, slug, name, description, execution_scope, agent_role, agent_title,
  master_prompt, execution_mode,
  heartbeat_enabled, heartbeat_interval_hours,
  default_token_budget, default_max_tool_calls,
  is_published, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'portfolio-health-agent',
  'Portfolio Health Agent',
  'Monitors portfolio health across all accounts, detects anomalies, scores churn risk, generates reports, and escalates interventions through HITL gates.',
  'org',
  'analyst',
  'Portfolio Health Analyst',
  'You are the Portfolio Health Agent. Your responsibility is to monitor the health of all accounts in this organisation''s portfolio.

On each scheduled scan:
1. Read metrics from canonical_metrics for each active account
2. Compute health scores using the configured factor definitions
3. Detect anomalies by comparing current metrics against historical baselines
4. Evaluate churn risk using the configured signal definitions
5. Generate alerts for accounts requiring attention
6. Propose interventions for critical issues (these go through human approval)
7. Write org-level insights about cross-account patterns

You operate at the organisation level. You can see all accounts but must not modify subaccount data without explicit HITL approval.

Focus on actionable intelligence. Flag what matters. Skip what doesn''t.',
  'api',
  true,
  4,
  50000,
  30,
  true,
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- GHL Agency Intelligence: system hierarchy template
INSERT INTO system_hierarchy_templates (
  id, name, description, status,
  required_connector_type, operational_defaults, memory_seeds_json,
  required_operator_inputs,
  created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'GHL Agency Intelligence',
  'Complete intelligence template for GoHighLevel agencies managing client portfolios. Includes portfolio health monitoring, anomaly detection, churn risk scoring, and HITL-gated interventions.',
  'published',
  'ghl',
  '{
    "healthScoreFactors": [
      {"metricSlug": "pipeline_velocity", "weight": 0.30, "label": "Pipeline Velocity", "periodType": "rolling_30d", "normalisation": {"type": "inverse_linear", "minValue": 0, "maxValue": 100}},
      {"metricSlug": "conversation_engagement", "weight": 0.25, "label": "Conversation Engagement", "periodType": "rolling_30d", "normalisation": {"type": "linear", "minValue": 0, "maxValue": 100}},
      {"metricSlug": "contact_growth_rate", "weight": 0.20, "label": "Contact Growth", "periodType": "rolling_30d", "normalisation": {"type": "linear", "minValue": -50, "maxValue": 50}},
      {"metricSlug": "revenue_trend", "weight": 0.15, "label": "Revenue Trend", "periodType": "rolling_30d", "normalisation": {"type": "linear", "minValue": -100, "maxValue": 100}},
      {"metricSlug": "platform_activity", "weight": 0.10, "label": "Platform Activity", "periodType": "rolling_7d", "normalisation": {"type": "linear", "minValue": 0, "maxValue": 100}}
    ],
    "anomalyConfig": {
      "defaultThreshold": 2.0,
      "defaultWindowDays": 30,
      "seasonality": "day_of_week",
      "minimumDataPoints": 14,
      "dedupWindowMinutes": 60
    },
    "churnRiskSignals": [
      {"signalSlug": "health_trajectory_decline", "weight": 0.30, "type": "metric_trend", "metricSlug": "health_score", "condition": "declining_over_periods", "periods": 3},
      {"signalSlug": "pipeline_stagnation", "weight": 0.25, "type": "metric_threshold", "metricSlug": "pipeline_velocity", "condition": "above_value", "thresholdValue": 60},
      {"signalSlug": "engagement_decline", "weight": 0.25, "type": "metric_threshold", "metricSlug": "conversation_engagement", "condition": "below_value", "thresholdValue": 30},
      {"signalSlug": "low_health", "weight": 0.20, "type": "health_score_level", "thresholdValue": 40}
    ],
    "interventionTypes": [
      {"slug": "notify_operator", "label": "Notify Operator", "gateLevel": "auto", "action": "internal_notification", "cooldownHours": 4},
      {"slug": "pause_campaign", "label": "Pause Campaign", "gateLevel": "review", "action": "connector_action", "connectorAction": "pause_campaign", "cooldownHours": 24, "cooldownScope": "executed"},
      {"slug": "escalate_to_am", "label": "Escalate to Account Manager", "gateLevel": "review", "action": "create_task", "cooldownHours": 24, "cooldownScope": "executed"},
      {"slug": "send_checkin", "label": "Send Check-in Email", "gateLevel": "review", "action": "send_email", "cooldownHours": 48, "cooldownScope": "executed"}
    ],
    "alertLimits": {"maxAlertsPerRun": 20, "maxAlertsPerAccountPerDay": 3, "batchLowPriority": true},
    "coldStartConfig": {"minimumDataPoints": 14, "allowHeuristicScoring": false},
    "scanFrequencyHours": 4,
    "reportSchedule": {"dayOfWeek": 1, "hour": 8},
    "maxAccountsPerRun": 50,
    "maxConcurrentEvaluations": 5,
    "maxRunDurationMs": 300000,
    "accountPriorityMode": "round_robin",
    "maxSkipCyclesPerAccount": 3,
    "metricAvailabilityMode": "lenient",
    "dataRetention": {"metricHistoryDays": 180, "healthSnapshotDays": 365, "anomalyEventDays": 90, "orgMemoryDays": 365, "syncAuditLogDays": 30, "canonicalEntityDays": null}
  }'::jsonb,
  '[{"content": "This organisation manages a portfolio of client accounts. Monitor for pipeline stagnation, lead volume drops, and conversation engagement decline.", "entryType": "preference"}]'::jsonb,
  '[{"key": "ghl_oauth", "label": "GHL OAuth Credentials", "type": "oauth", "required": true}, {"key": "alert_email", "label": "Alert Email", "type": "email", "required": true}, {"key": "slack_webhook", "label": "Slack Webhook URL", "type": "url", "required": false}]'::jsonb,
  now(),
  now()
) ON CONFLICT DO NOTHING;
