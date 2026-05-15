import type { SkillHandler } from '../context.js';

// ---------------------------------------------------------------------------
// executeMethodologySkill — scaffold-only dispatch for LLM-guided skills.
// The actual reasoning is performed by the agent using its injected
// instructions. The executor returns a structured scaffold the agent fills.
// ---------------------------------------------------------------------------

function executeMethodologySkill(
  skillName: string,
  _input: Record<string, unknown>,
  scaffold: { template: Record<string, unknown>; guidance: string }
): { success: true; skillName: string; template: Record<string, unknown>; guidance: string } {
  return {
    success: true,
    skillName,
    template: scaffold.template,
    guidance: scaffold.guidance,
  };
}

export const methodologyStubHandlers: Record<string, SkillHandler> = {
  // ── Dev Agent methodology skills ─────────────────────────────────────
  draft_architecture_plan: async (input) => {
    return executeMethodologySkill('draft_architecture_plan', input, {
      template: {
        intent: '',
        classification: '',
        implementationChunks: [],
        contracts: [],
        failureModes: [],
        openQuestions: [],
        affectedFiles: [],
        testStrategy: '',
      },
      guidance: 'Fill in each section of the architecture plan template above. Use the methodology instructions in your context. Return the completed plan as your tool result.',
    });
  },
  draft_tech_spec: async (input) => {
    return executeMethodologySkill('draft_tech_spec', input, {
      template: {
        openApiChanges: '',
        schemaChanges: '',
        sequenceDiagram: '',
        migrationPlan: '',
        breakingChanges: [],
        envVarChanges: [],
      },
      guidance: 'Fill in each section of the tech spec template. Omit sections not applicable to this change.',
    });
  },
  review_ux: async (input) => {
    return executeMethodologySkill('review_ux', input, {
      template: {
        findings: [],
        highPriority: [],
        mediumPriority: [],
        lowPriority: [],
        recommendation: 'proceed | revise | escalate',
      },
      guidance: 'Evaluate each changed UI surface against the UX checklist in your context. Populate findings by priority.',
    });
  },
  review_code: async (input) => {
    return executeMethodologySkill('review_code', input, {
      template: {
        blocking: [],
        nonBlocking: [],
        securityIssues: [],
        planComplianceIssues: [],
        acCoverageGaps: [],
        recommendation: 'approve | revise | escalate',
      },
      guidance: 'Review each changed file against the checklist in your context. Only blocking issues prevent submission.',
    });
  },
  write_tests: async (input) => {
    return executeMethodologySkill('write_tests', input, {
      template: {
        targetFile: '',
        framework: '',
        testCases: [],
        coveredScenarios: [],
        deferredScenarios: [],
        estimatedCoverageDelta: '',
      },
      guidance: 'Follow the test authorship methodology in your context. For each scenario, write the test case and submit via write_patch.',
    });
  },

  // ── BA / QA MVP skills ───────────────────────────────────────────────
  draft_requirements: async (input) => {
    return executeMethodologySkill('draft_requirements', input, {
      template: {
        taskId: '',
        status: 'draft',
        userStories: [],
        openQuestions: [],
        definitionOfDone: [],
        traceability: [],
      },
      guidance: 'Follow the draft_requirements methodology in your skill context. Produce a structured requirements spec with INVEST user stories, Gherkin ACs (AC-X.Y format, Type: positive/negative), ranked open questions, and a Definition of Done. If the brief is too ambiguous, return a clarification_required response instead of a partial spec.',
    });
  },
  derive_test_cases: async (input) => {
    return executeMethodologySkill('derive_test_cases', input, {
      template: {
        specReferenceId: '',
        manifestValidFor: '',
        taskId: '',
        testCases: [],
        coverageMatrix: [],
        untestableAcs: [],
      },
      guidance: 'Follow the derive_test_cases methodology in your skill context. For each Gherkin AC in the spec, produce a test case with a stable TC-[task_id]-NNN ID, preconditions, action, and expected result. Write the completed manifest to workspace memory via write_workspace.',
    });
  },

  // ── Support Agent skills ─────────────────────────────────────────────
  classify_email: async (input) => {
    return executeMethodologySkill('classify_email', input, {
      template: {
        emailReference: '',
        primaryIntent: '',
        urgency: '',
        sentiment: '',
        routingAction: '',
        isAutomated: false,
        keySignals: [],
        classificationNotes: '',
        suggestedReplyTone: '',
      },
      guidance: 'Follow the classify_email methodology in your skill context. Classify the email by intent category, urgency, sentiment, and routing action. Return the structured classification result.',
    });
  },
  draft_reply: async (input) => {
    return executeMethodologySkill('draft_reply', input, {
      template: {
        to: '',
        subject: '',
        confidence: '',
        routingAction: '',
        body: '',
        confidenceFlags: [],
        draftingNotes: '',
      },
      guidance: 'Follow the draft_reply methodology in your skill context. Use the classification output and knowledge base context to draft a concise, on-brand reply. If routing_action is escalate, return an escalation response instead of a draft.',
    });
  },

  // ── Social Media Agent skills ────────────────────────────────────────
  draft_post: async (input) => {
    return executeMethodologySkill('draft_post', input, {
      template: {
        brief: '',
        platforms: [],
        brandVoice: '',
        drafts: {},
        sharedNotes: '',
        verifyItems: [],
      },
      guidance: 'Follow the draft_post methodology in your skill context. Produce platform-specific post variants for each requested platform, respecting character limits, hashtag strategies, and brand voice. Flag any claims that need verification with [VERIFY] placeholders.',
    });
  },
  analyse_performance: async (input) => {
    return executeMethodologySkill('analyse_performance', input, {
      template: {
        period: '',
        campaignsAnalysed: 0,
        executiveSummary: '',
        campaigns: [],
        anomalies: [],
        rankedActions: [],
        caveats: [],
      },
      guidance: 'Follow the analyse_performance methodology in your skill context. Analyse the campaign data from read_campaigns, identify underperformers and anomalies, and produce ranked recommendations (pause, reduce_bid, increase_budget, test_copy, monitor).',
    });
  },
  draft_ad_copy: async (input) => {
    return executeMethodologySkill('draft_ad_copy', input, {
      template: {
        campaignName: '',
        platform: '',
        adFormat: '',
        variants: [],
        copyNotes: '',
        verifyItems: [],
      },
      guidance: 'Follow the draft_ad_copy methodology in your skill context. Produce the requested number of meaningfully different ad copy variants within platform character limits. State the test hypothesis for each variant. Use [VERIFY] for unconfirmed claims.',
    });
  },

  // ── Email Outreach Agent skills ──────────────────────────────────────
  draft_sequence: async (input) => {
    return executeMethodologySkill('draft_sequence', input, {
      template: {
        contactEmail: '',
        goal: '',
        steps: [],
        draftingNotes: '',
        unresolvedTokens: [],
        verifyItems: [],
      },
      guidance: 'Follow the draft_sequence methodology in your skill context. Produce a multi-step outreach sequence with distinct purpose per step. Use enrichment data for personalisation if available; fall back to generic copy if enrichment is a stub. Flag all [VERIFY] items and unresolved personalisation tokens.',
    });
  },

  // ── Finance Agent skills ─────────────────────────────────────────────
  analyse_financials: async (input) => {
    return executeMethodologySkill('analyse_financials', input, {
      template: {
        period: '',
        dataQuality: '',
        executiveSummary: '',
        keyMetrics: {},
        revenueAnalysis: '',
        expenseAnalysis: '',
        anomalies: [],
        recommendations: [],
        caveats: [],
      },
      guidance: 'Follow the analyse_financials methodology in your skill context. Compute key ratios from the revenue and expense data, identify anomalies, and produce ranked recommendations. If either data source is a stub, note unavailability and compute only what is possible.',
    });
  },

  // ── Strategic Intelligence Agent skills ──────────────────────────────
  generate_competitor_brief: async (input) => {
    return executeMethodologySkill('generate_competitor_brief', input, {
      template: {
        competitor: '',
        researchDate: '',
        executiveSummary: '',
        productAndPricing: {},
        recentDevelopments: [],
        strengths: [],
        weaknesses: [],
        competitiveImplications: '',
        sources: [],
        gaps: [],
      },
      guidance: 'Follow the generate_competitor_brief methodology in your skill context. Use web_search to retrieve current competitor pricing, product info, and recent news. Do not rely on training data for facts that change frequently. Mark unverifiable claims with [VERIFY].',
    });
  },
  synthesise_voc: async (input) => {
    return executeMethodologySkill('synthesise_voc', input, {
      template: {
        sources: [],
        period: '',
        dataPoints: 0,
        executiveSummary: '',
        sentimentBreakdown: {},
        topThemes: [],
        topPraise: [],
        topPainPoints: [],
        featureRequests: [],
        churnSignals: [],
        focusQuestionAnswers: [],
        strategicImplications: [],
        dataCaveats: [],
      },
      guidance: 'Follow the synthesise_voc methodology in your skill context. Extract recurring themes from the VoC data, compute sentiment breakdown, and answer any focus questions explicitly. Do not fabricate quotes — paraphrase only from the actual voc_data input.',
    });
  },

  // ── Content/SEO Agent skills ─────────────────────────────────────────
  draft_content: async (input) => {
    return executeMethodologySkill('draft_content', input, {
      template: {
        contentType: '',
        title: '',
        primaryKeyword: '',
        wordCount: 0,
        body: '',
        draftingNotes: '',
        verifyItems: [],
        todoItems: [],
      },
      guidance: 'Follow the draft_content methodology in your skill context. Produce a structured draft for the requested content type within the target word count. Apply brand voice, include SEO recommendations if a primary keyword is provided, and mark unverifiable claims with [VERIFY].',
    });
  },
  audit_seo: async (input) => {
    return executeMethodologySkill('audit_seo', input, {
      template: {
        page: '',
        targetKeyword: '',
        overallScore: 0,
        summary: '',
        criticalIssues: [],
        highPriority: [],
        mediumPriority: [],
        lowPriority: [],
        quickWins: [],
        notes: '',
      },
      guidance: 'Follow the audit_seo methodology in your skill context. Evaluate the page content against the on-page SEO checklist, score based on findings, and produce a prioritised list of specific recommendations.',
    });
  },

  // ── GEO (Generative Engine Optimisation) skills ─────────────────────
  audit_geo: async (input) => {
    return executeMethodologySkill('audit_geo', input, {
      template: {
        url: '',
        targetKeyword: '',
        geoScore: 0,
        executiveSummary: '',
        dimensionScores: {
          aiCitability: { score: 0, findings: [], recommendations: [] },
          brandAuthority: { score: 0, findings: [], recommendations: [] },
          contentQuality: { score: 0, findings: [], recommendations: [] },
          technicalInfrastructure: { score: 0, findings: [], recommendations: [] },
          structuredData: { score: 0, findings: [], recommendations: [] },
          platformSpecific: { score: 0, findings: [], recommendations: [] },
        },
        priorityRecommendations: [],
        thirtyDayRoadmap: { week1: [], week2to3: [], week4: [] },
        competitiveBenchmark: null,
        notes: '',
      },
      guidance: 'Follow the audit_geo methodology in your skill context. Use fetch_url to retrieve the page, then evaluate all six GEO dimensions. Compute the composite GEO Score as a weighted sum. Produce specific, actionable recommendations ranked by impact.',
    });
  },
  geo_citability: async (input) => {
    return executeMethodologySkill('geo_citability', input, {
      template: {
        url: '',
        citabilityScore: 0,
        passageAnalysis: { total: 0, optimalRange: 0, averageLength: 0 },
        claimDensity: { verifiableClaims: 0, claimsPer200Words: 0 },
        quotableStructures: { definitions: 0, faqPairs: 0, lists: 0, summaries: 0 },
        findings: [],
        recommendations: [],
      },
      guidance: 'Follow the geo_citability methodology. Analyse content for AI citation extractability — focus on passage length (134-167 words optimal), claim density, quotable structures, and semantic clarity.',
    });
  },
  geo_crawlers: async (input) => {
    return executeMethodologySkill('geo_crawlers', input, {
      template: {
        domain: '',
        accessScore: 0,
        crawlerMatrix: [],
        robotsTxtSummary: { found: false, globalBlock: false, aiDirectives: 0 },
        httpHeaders: { xRobotsTag: '', metaRobotsAi: '' },
        llmsTxtPresent: false,
        recommendations: [],
      },
      guidance: 'Follow the geo_crawlers methodology. Use fetch_url to check robots.txt and the target page. Evaluate access for all 14+ AI crawlers listed in the methodology. Report the crawler access matrix.',
    });
  },
  geo_schema: async (input) => {
    return executeMethodologySkill('geo_schema', input, {
      template: {
        url: '',
        pageType: '',
        schemaScore: 0,
        schemasFound: [],
        missingSchemas: [],
        qualityIssues: [],
        recommendations: [],
        jsonLdTemplate: '',
      },
      guidance: 'Follow the geo_schema methodology. Use fetch_url to retrieve the page HTML, extract all JSON-LD blocks, validate structure and coverage against page type expectations, and provide ready-to-use templates for missing schemas.',
    });
  },
  geo_platform_optimizer: async (input) => {
    return executeMethodologySkill('geo_platform_optimizer', input, {
      template: {
        url: '',
        targetKeyword: '',
        overallScore: 0,
        platforms: {
          googleAio: { score: 0, findings: [], topRecommendation: '' },
          chatgpt: { score: 0, findings: [], topRecommendation: '' },
          perplexity: { score: 0, findings: [], topRecommendation: '' },
          gemini: { score: 0, findings: [], topRecommendation: '' },
          bingCopilot: { score: 0, findings: [], topRecommendation: '' },
        },
        crossPlatformRecommendations: [],
      },
      guidance: 'Follow the geo_platform_optimizer methodology. Evaluate the page against each AI search platform\'s specific preferences — content format, source signals, and crawler access. Produce per-platform scores and cross-platform recommendations.',
    });
  },
  geo_brand_authority: async (input) => {
    return executeMethodologySkill('geo_brand_authority', input, {
      template: {
        brandName: '',
        authorityScore: 0,
        entityRecognition: { wikipedia: false, wikidata: '', knowledgePanel: false, otherSources: [] },
        mentionAnalysis: { count: 0, topSources: [], sentiment: '', mostRecent: '' },
        citationProfile: { citationMentions: 0, expertQuotes: 0, originalResearch: 0 },
        authorSignals: { namedAuthors: 0, withCredentials: 0, schemaMarkup: false },
        recommendations: [],
      },
      guidance: 'Follow the geo_brand_authority methodology. Use web_search to research brand presence across Wikipedia, Wikidata, Knowledge Panel, and authoritative publications. Assess entity recognition, mention density, and citation patterns.',
    });
  },
  geo_llmstxt: async (input) => {
    return executeMethodologySkill('geo_llmstxt', input, {
      template: {
        domain: '',
        mode: 'analyse',
        llmsTxtStatus: 'not_found',
        llmsFullTxtStatus: 'not_found',
        score: 0,
        assessment: { structure: '', completeness: '', accuracy: '', length: 0 },
        issues: [],
        recommendedContent: '',
        recommendations: [],
      },
      guidance: 'Follow the geo_llmstxt methodology. Use fetch_url to check for llms.txt and llms-full.txt at the domain root. In analyse mode, evaluate structure and quality. In generate mode, produce a complete recommended llms.txt.',
    });
  },
  geo_compare: async (input) => {
    return executeMethodologySkill('geo_compare', input, {
      template: {
        clientUrl: '',
        competitorUrls: [],
        targetKeyword: '',
        comparisonMatrix: [],
        clientStrengths: [],
        clientGaps: [],
        quickWins: [],
        strategicRecommendations: [],
        notes: '',
      },
      guidance: 'Follow the geo_compare methodology. Use fetch_url to retrieve all pages (client + competitors). Score each across the six comparison dimensions and produce a side-by-side matrix with specific gap analysis and actionable recommendations.',
    });
  },

  // ── Client Reporting Agent skills ────────────────────────────────────
  draft_report: async (input) => {
    return executeMethodologySkill('draft_report', input, {
      template: {
        reportType: '',
        clientName: '',
        reportingPeriod: '',
        executiveSummary: [],
        sections: [],
        recommendations: [],
        draftingNotes: '',
        verifyItems: [],
        todoItems: [],
      },
      guidance: 'Follow the draft_report methodology in your skill context. Produce a structured client-facing report from the provided data sections. Lead each section with the key finding, compare to targets where available, and write recommendations specific to this client\'s data.',
    });
  },

  // ── CRM/Pipeline Agent skills ────────────────────────────────────────
  analyse_pipeline: async (input) => {
    return executeMethodologySkill('analyse_pipeline', input, {
      template: {
        period: '',
        dataQuality: '',
        executiveSummary: '',
        keyMetrics: {},
        stageBreakdown: [],
        staleDeals: [],
        rankedActions: [],
        caveats: [],
      },
      guidance: 'Follow the analyse_pipeline methodology in your skill context. Compute pipeline velocity, stage conversion, and stale deal metrics from the CRM data. Identify deals requiring follow-up and produce ranked actions.',
    });
  },
  draft_followup: async (input) => {
    return executeMethodologySkill('draft_followup', input, {
      template: {
        contactEmail: '',
        dealName: '',
        goal: '',
        subject: '',
        body: '',
        draftingNotes: '',
      },
      guidance: 'Follow the draft_followup methodology in your skill context. Draft a short (3–5 sentence) follow-up email referencing the last activity. Match tone to days-since-activity. Include a single, clear CTA matching the follow_up_goal.',
    });
  },
  detect_churn_risk: async (input) => {
    return executeMethodologySkill('detect_churn_risk', input, {
      template: {
        accountsAnalysed: 0,
        atRiskAccounts: [],
        healthyAccounts: [],
        summary: '',
        caveats: [],
      },
      guidance: 'Follow the detect_churn_risk methodology in your skill context. Score each account based on engagement, commercial, and relationship signals. Never assign HIGH or CRITICAL risk without 2+ supporting signals. Produce specific recommended interventions per at-risk account.',
    });
  },

  // ── 42 Macro analysis (custom prompt skill, scoped to Breakout Solutions) ──
  analyse_42macro_transcript: async (input) => {
    return executeMethodologySkill('analyse_42macro_transcript', input, {
      template: {
        filename: 'YYYYMMDD_Report_Name.md',
        tier1Dashboard: '',
        tier2ExecutiveSummary: '',
        tier3FullAnalysis: {
          section1MacroSnapshot: '',
          section2BitcoinAndDigitalAssets: '',
          section3TheBottomLine: '',
        },
      },
      guidance:
        'Follow the 42 Macro A-Player Brain instructions injected into your system prompt. Output the three tiers (Dashboard, Executive Summary, Full Analysis) in plain language. Return the completed markdown content as the value of the tier3FullAnalysis fields and the rendered filename. The agent will pass the result to send_to_slack.',
    });
  },

  // ── Generic methodology fallback (does NOT use executeMethodologySkill scaffold) ──
  generic_methodology: async (input) => {
    const skillName = typeof input.skillName === 'string' ? input.skillName : 'unknown';
    return {
      success: true,
      skillName,
      guidance: 'Follow the methodology instructions in your skill context to complete this task.',
    };
  },
};
