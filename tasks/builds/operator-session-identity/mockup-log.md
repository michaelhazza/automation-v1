# Mockup Log — operator-session-identity

## Round 13 — 2026-05-11
**Operator feedback:** Comprehensive review feedback. Three categories: (1) vocabulary lock across all screens, (2) brief-mandated coverage gaps filled, (3) polish sweep.

**Changes made:**

Vocabulary lock (P0):
- Verb lock applied: "Connect" (CTA), "Sign in again" (re-auth), "Disconnect" (remove), "Turn off agent use" (pause), "Transfer ownership", "Make default", "Edit availability". All rogue variants ("Re-authenticate", "Re-auth", "Revoke", "Set as subaccount default", "Re-auth") removed.
- Status pill vocabulary locked to 6 states: "Connected" (was "Usable"), "Needs consent", "Needs sign in" (was "Needs re-auth"), "Plan not verified" (new), "Revoked by OpenAI" (new), "Disabled".
- "AI Subscription" capitalisation: proper noun in headings/CTAs, lowercase in body prose.
- Confirmation pattern justification: type-to-confirm for Disconnect (screen 15, irreversible), typed phrase for Plus first-time connect (screen 03), checkbox for repeated consent (screen 17 State B, screen 18). Screen 03 explainer sub-line added: "First-time connection requires you to type the phrase below. Future Plus-related confirmations will be a checkbox."

Coverage gaps (P1):
- E: connected_unverified state: added "ChatGPT Enterprise (Legal)" row on screen 01 with "Plan not verified" chip and "Verifying your plan with OpenAI." sub-label. Added state variant section stacked on screen 04 with amber-grey banner, disabled toggle, disabled Make Default.
- F: Screen 18 created: disclosure version bump modal. Amber header "Plus terms have been updated". Subscription identity line (ChatGPT Plus Marketing, Disabled/Needs new consent). Updated disclosure text with ToS placeholder. Checkbox re-acknowledgement. "Accept and continue" / "Disconnect this subscription". Footer: "Disclosure version: 2 (was 1) · Updated 14 May 2026".
- G: Screen 19 created: Revoked by OpenAI state. Red status pill "Revoked by OpenAI". Red prominent banner "OpenAI ended this session." Actions: Sign in again (primary, Org admin only) / Transfer ownership / Disconnect (Org admin only). No toggle (credential unusable until re-auth). Audit footer with operator_session.revoked event. Compare link to screen 06.
- H: Gated connect button state on screen 01: "Connect AI Subscription" button disabled (cursor: not-allowed), info banner explaining verification in progress. Stacked as state variant with labelled divider.
- I: Empty state on screen 01: centered empty-state block with icon, heading "No AI Subscriptions connected yet.", one-sentence body, primary CTA, learn more link. Stacked as state variant.

Polish sweep (P2/P3):
- J: "Primary" micro-label removed from screen 01 Default row. Default pill alone carries the role.
- K: Inline prototype note removed from screen 02 (yellow note about Plus branch).
- L: Tab subtitles added below tab strip on all three tabs (01, 01b, 01c): AI Subscriptions subtitle "AI plans your autonomous agents can use to think, like ChatGPT"; App Integrations "Apps your agents use to do work, like Gmail or HubSpot"; Web Logins "Logins to websites that don't have an integration".
- M: Date format applied: under 7 days relative ("3 hours ago", "3 days ago", "Yesterday"), 7+ days absolute ("14 May 2026"). "at HH:MM UTC" dropped everywhere except consent record audit row.
- N: "OpenAI confirmed this plan" replaces "via OpenAI plan API" across screens 02, 04, 05. Info-icon tooltip: "We verified your plan tier directly with OpenAI when you connected."
- O: "Org admin only" pill added uniformly to: Allow agent use toggle (04), Disconnect action (04, 05, 15 modal title, 01 3-dot menu), Sign in again (05 sidebar, 01 3-dot menu, 19 sidebar), Make default (01 3-dot menu, 17 modal title), Edit availability (01 3-dot menu, 04 detail page). Admin-view mockups show pill; non-admin view would hide control entirely.
- P: Screen 20 created: "Sign in again to ChatGPT Team (Sandbox)" lightweight modal. Sub-line: "We'll refresh your connection. Your plan and settings stay the same." Single CTA: "Continue to OpenAI". No plan detection, no step bar. Footer note about identity mismatch. Screen 05 "Sign in again" now links to screen 20.
- Q: ToS placeholder "[Legal will add link]" added to screen 03 and screen 18 disclosure text.
- R: 4-step step bar on screens 02 and 03. Step 3 (Accept terms) muted on screen 02 happy path with sub-label "personal plans only". Active on screen 03 Plus path.
- S: HubSpot screen 11 primary action renamed "Connect and test" (was "Save and test").

Index updated: subtitle updated to "Twenty screens", new screens 18/19/20 added, screen descriptions updated for 01/02/03/04/05/11/17.

**Frontend-design-principles checks:**
- Start with primary task: yes. Every new screen leads with the user action. Screen 20 strips the re-auth flow to a single provider button. Screen 18 leads with the subscription identity and the single re-acceptance checkbox.
- Default to hidden: yes. Screen 19 omits the Allow agent use toggle entirely (credential unusable). Screen 04 unverified variant disables the toggle with clear explanation. All gated controls show "Org admin only" pill in admin view.
- One primary action: yes. Screen 18: "Accept and continue" (with escape path Disconnect). Screen 19: "Sign in again" (primary). Screen 20: "Continue to OpenAI". Screen 01 empty state: single CTA.
- Inline state: yes. "Plan not verified" chip inline on list row with sub-label "Verifying your plan." Status pill vocabulary is now consistent across list and detail views.
- Re-check passed: yes. Non-technical operator on screen 20 sees the subscription name, one button. On screen 18 sees the subscription, reads updated terms, checks one box. On screen 19 sees the banner "OpenAI ended this session" and three clear actions.

**Rule violations flagged:** none.

**Deferred (not actioned this round):**
- P2 #11, #14: already substantially simplified in round 12; monitor on next pass.
- P3 #15 (emoji icons to SVG icons): needs a proper icon system decision; flag for a focused visual round.
- P3 #23 (mobile responsiveness): deferred until product roadmap calls for it.
- P4 #24-27 (provider capability registry, failure classification, retention under deletion, redaction surface): spec-author concerns to surface during Step 6 spec authoring, not mockup changes.

**Files modified:**
- `prototypes/operator-session-identity/01-connections-list.html` (vocabulary lock, status pill lock, tab subtitle, remove Primary micro-label, connected_unverified row, gated state variant, empty state variant, permission pills, relative dates)
- `prototypes/operator-session-identity/01b-app-integrations-tab.html` (tab subtitle)
- `prototypes/operator-session-identity/01c-web-logins-tab.html` (tab subtitle)
- `prototypes/operator-session-identity/02-connect-wizard.html` (4-step bar, prototype note removed, "OpenAI confirmed this plan", CTA verb)
- `prototypes/operator-session-identity/03-disclosure-plus.html` (4-step bar, ToS placeholder, confirmation pattern explainer sub-line, Cancel label)
- `prototypes/operator-session-identity/04-subscription-detail.html` (status pill "Connected", action verbs Sign in again / Disconnect, "OpenAI confirmed this plan", availability edit + permission pill, JS function renamed, connected_unverified state variant stacked)
- `prototypes/operator-session-identity/05-reauth-state.html` (status pill "Needs sign in", action verbs Sign in again / Disconnect, permission pills, date format, links to screen 20)
- `prototypes/operator-session-identity/11-connect-app-hubspot.html` (primary action "Connect and test")
- `prototypes/operator-session-identity/15-disconnect-confirm.html` (nav links fixed to 01-connections-list.html, Org admin only pill on modal title)
- `prototypes/operator-session-identity/17-make-default-confirm.html` (Org admin only pill on modal titles)
- `prototypes/operator-session-identity/18-disclosure-version-bump.html` (CREATED)
- `prototypes/operator-session-identity/19-revoked-by-openai-state.html` (CREATED)
- `prototypes/operator-session-identity/20-sign-in-again-light.html` (CREATED)
- `prototypes/operator-session-identity/index.html` (subtitle updated, screen descriptions updated, new screens 18/19/20 added)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 12 — 2026-05-11 23:45
**Operator feedback:** Copy has accumulated across 11 rounds. Two specific issues: (1) the word "sanctioned" appears in screen 17 UI copy, (2) screen 04 is text-heavy with spec-excerpt prose. Full simplification pass requested across all screens.

**Changes made:**
- Vocabulary palette established and applied across all 18 screens:
  - "sanctioned" / "OpenAI-sanctioned" removed from all user-facing copy (screen 17 warning callout, checkbox label, success banner, index description, state-section dividers)
  - "Operator Controller" removed from all user-facing copy. Replaced with "autonomous agents", "autonomous runs", "future runs" per context
  - "Phase 3+" removed from all user-facing body copy. Replaced with "Available soon" badge (screen 08) and "(ship soon)" inline (screen 01 explainer)
  - "allowlisted" as verb removed from body copy; replaced with "allowed to use it"
  - "router" replaced with "system" in screen 08 footer note
  - "subaccount default" simplified to "Default" in screen 17 modal copy
- Screen 01 explainer banner: trimmed 3-sentence policy description to 1 sentence: "When autonomous agent runs ship soon, the system uses your Default first..."
- Screen 02: Page subtitle rewritten (1 sentence). Detection card copy updated to "business plan" language.
- Screen 03: Title changed "Consent required" to "Connect ChatGPT Plus". Sub-line updated. Submit button label updated to "Connect ChatGPT Plus".
- Screen 04 (biggest target): Significant structural trim:
  - Metadata block consolidated into a single horizontal info strip (plan badge, status pill, owner, last refreshed). All verbose rows (verified_at, verification_status, connected_at, scope) collapsed into a "Details" expander, closed by default.
  - "Default subscription" section removed as a standalone section; Default pill is already inline on the card title.
  - "Availability" section trimmed to one line: "Available to: All agents" with Edit link.
  - "Currently used by" section trimmed to 1 sentence: "No agents are using this yet. Autonomous agents (the long-running ones) ship soon."
  - Toggle hint simplified: "Turn off to block all agents from using this AI Subscription, even ones already allowed."
  - Toggle label renamed from "Available for agent use" to "Allow agent use".
  - Transfer ownership remains in sidebar action row (no change to structure).
- Screen 05: Banner trimmed to 1 sentence "Sign in again to keep this AI Subscription working." CTA renamed "Sign in". "Currently used by" updated to remove Phase 3+ language.
- Screen 06: Banner trimmed to 1 sentence "The original owner is no longer active. Transfer ownership or sign in again to keep this connection working." CTAs: "Transfer ownership" + "Sign in again". Sidebar hint trimmed.
- Screen 07: Page title changed to "Who can use this?" Sub-line "ChatGPT Pro (Marketing)" below title. Intro paragraph trimmed. Radio option hint sub-lines removed (options self-describe).
- Screen 08: Explainer banner trimmed to 1 sentence "This shows where this agent gets its intelligence. Set permissions on the Connections page." Native Controller sub-section renamed "Standard runs". Operator Controller sub-section renamed "Autonomous runs" with "Available soon" badge (was "Phase 3+"). Sub-labels trimmed. Source note simplified to just the Edit link. Router footer note simplified to "The system picks based on what's available."
- Screen 12: Sub-line form hints removed from main fields (label, login URL, username, password). "Save first, then test from the row" note removed. Nav links fixed to point to 01c-web-logins-tab.html (01b-connections-tools-tab.html no longer exists).
- Screen 13: Password field hint removed. Nav links fixed to 01c-web-logins-tab.html.
- Screen 14: Body copy trimmed to "Pick which agent to attribute this test to." Form-hint under agent dropdown removed. Running state copy trimmed. Nav links fixed to 01c-web-logins-tab.html.
- Screen 15: Body copy trimmed to one sentence "This stops agents from using this connection."
- Screen 17: State A and State B rewrites per brief:
  - Section dividers: "Sanctioned tier" replaced with "Business plan", "Plus tier" replaced with "Personal plan"
  - State A: Intro trimmed to 1 sentence. Impact block relabelled (Now Default, New Default, Agents affected). "~5 agents in this subaccount" count simplified to "5" with hover tooltip. Timing note moved to small grey footer text. "Make default" button renamed "Make Default".
  - State B: Header sub-line removed. Warning callout trimmed to 1 sentence "ChatGPT Plus is a personal plan. Confirm you accept the risks before making it the Default." Checkbox label rewritten: "I accept the risk of using a personal plan for business automation." Disclosure body copy de-jargoned (removed "sanctioned"). Success banner updated. "Make Plus the default" button renamed "Make Plus the Default".
- index.html: Screen 08 description updated. Screen 17 description updated. Round 12 subtitle note added.

**Frontend-design-principles checks:**
- Start with primary task: yes. Every screen continues to lead with the primary user action. Screen 04 structural trim makes the action row more prominent by reducing surrounding noise.
- Default to hidden: yes. Screen 04 Details expander collapses verbose metadata by default. Advanced fields in screens 12/13 remain collapsed. Model Access section 08 remains read-only.
- One primary action: yes. No screen has competing primary actions. Screen 06 has two CTAs (Transfer / Sign in again) which is acceptable as these are two paths for the same crisis recovery task.
- Inline state: yes. Status dots, Default pills, tier badges all remain inline. Amber tint on Plus state in screen 17 communicates risk without a separate warning page.
- Re-check passed: yes. Screen 04 now fits in roughly half the vertical space of round 11 while maintaining all necessary information. Screen 17 State A body is 1 sentence + 3 stat rows + a grey footer note. Screen 08 explainer is 1 sentence.

**Rule violations flagged:** none.

**Files modified:**
- `prototypes/operator-session-identity/01-connections-list.html` (explainer banner trimmed to 1 sentence)
- `prototypes/operator-session-identity/02-connect-wizard.html` (subtitle trimmed, detection copy updated)
- `prototypes/operator-session-identity/03-disclosure-plus.html` (title, sub-line, submit button updated)
- `prototypes/operator-session-identity/04-subscription-detail.html` (major structural trim: metadata strip, details expander, availability 1-line, currently-used-by 1-sentence, toggle label and hint)
- `prototypes/operator-session-identity/05-reauth-state.html` (banner 1 sentence, CTA "Sign in", currently-used-by trimmed)
- `prototypes/operator-session-identity/06-offboarding-state.html` (banner 1 sentence, CTAs renamed, sidebar hint trimmed)
- `prototypes/operator-session-identity/07-availability-edit.html` (title "Who can use this?", sub-line, intro and radio hints trimmed)
- `prototypes/operator-session-identity/08-agent-edit-model-access.html` (explainer 1 sentence, run types renamed, sub-labels trimmed, router note simplified)
- `prototypes/operator-session-identity/12-add-web-login.html` (form hints removed from main fields, btn-note removed, nav links fixed)
- `prototypes/operator-session-identity/13-edit-web-login.html` (password hint removed, nav links fixed)
- `prototypes/operator-session-identity/14-test-web-login.html` (body trimmed to 1 sentence, running copy trimmed, nav links fixed)
- `prototypes/operator-session-identity/15-disconnect-confirm.html` (body trimmed to 1 sentence)
- `prototypes/operator-session-identity/17-make-default-confirm.html` (State A and B rewrites: "sanctioned" removed everywhere, impact stats simplified, timing as grey footer, checkbox label rewritten, success banners updated)
- `prototypes/operator-session-identity/index.html` (screen 08 and 17 descriptions updated, round 12 subtitle note added)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 11 — 2026-05-11 23:00
**Operator feedback:** The one-click "Make default" action in the 3-dot menu has a wide blast radius: it reroutes every allowlisted agent's future Operator Controller runs. It should have a confirmation modal with impact preview. Plus-tier promotion additionally requires re-acknowledgement of the risk disclosure. Operator chose: confirmation modal with impact preview plus Plus-tier-specific re-acknowledgement (checkbox variant).

**Changes made:**
- `17-make-default-confirm.html` (CREATED): New screen. Both modal states shown stacked on one page, separated by a labelled divider, for operator comparison.
  - State A (sanctioned tier: Pro / Team / Enterprise): Clean white header. Title "Make ChatGPT Team the default?" Impact preview block (soft blue tint): current default (ChatGPT Pro, Pro badge), new default (ChatGPT Team, Team badge), applies to ~5 agents in this subaccount (hover tooltip shows 5 agent names: Marketing Assistant, Research Agent, Support Triage, Lead Qualifier, Sales Followup). Timing reassurance below block: "In-flight runs are not interrupted. The change takes effect on the next Operator Controller run for each affected agent." Two-click confirm: "Make default" (indigo) / Cancel. No risk acknowledgement. Post-confirm: inline green success banner replaces body, button label changes to "Done".
  - State B (Plus tier): Amber/warm tint header (gradient, amber caution icon, title "Make ChatGPT Plus the default?"). Warning callout at top explaining personal-tier blast radius. Same impact preview block (same shape as State A). Timing reassurance. Risk disclosure block (amber tint, placeholder Legal copy, disclosure version footer). Checkbox re-acknowledgement: "I understand this plan is not officially sanctioned for business automation and I accept the risk." Primary button ("Make Plus the default", amber) is disabled until checkbox is checked. Cancel always available. Post-confirm: inline green success banner.
  - Prototype note at top explains both entry points and that production shows one state at a time.
  - Interactive: State A "Make default" button fires after 800ms with inline success. State B checkbox enables/disables the primary action. "Making Plus the default..." transient state, then success banner.
- `01-connections-list.html` (updated): Both non-default AI Subscription rows' "Make default" 3-dot menu items now link to `17-make-default-confirm.html`. Previously they were non-interactive static items.
- `04-subscription-detail.html` (updated): Added a blue-tinted prototype note below the Default subscription section explaining that: this screen shows the current default; if the subscription were not the default, a "Set as subaccount default" button would appear in place of the Default pill; clicking it opens the Make Default confirmation modal (screen 17); Plus-tier subscriptions trigger State B with re-acknowledgement required.
- `index.html` (updated): Subtitle updated to "Seventeen screens." Round 11 note added to subtitle. r11-badge CSS class added (amber, matches r9-badge shape). Screen 17 entry added to Shared section with full description of both states and entry points.

**Frontend-design-principles checks:**
- Start with primary task: yes. The modal's primary task is "confirm or cancel a default change." The impact preview block is load-bearing: it directly answers "what changes, how many agents are affected, when does it take effect?" The re-acknowledgement on Plus answers "do I accept the risk?" No extraneous information.
- Default to hidden: yes. No dashboards, no KPI tiles, no cost panels. The agent name tooltip is progressive disclosure (hover). The risk disclosure is inline but shown only for Plus tier (the elevated-caution case). Standard tier shows no disclosure.
- One primary action: yes. Each state has exactly one primary action: "Make default" (State A) or "Make Plus the default" (State B). Cancel is always available but is not a primary action. No competing CTAs.
- Inline state: yes. Primary action disabled state (grey, cursor not-allowed) communicates "action not yet available" inline. Checkbox interaction immediately enables the button (no page load, no separate confirmation). Post-confirm success banner is inline within the modal body. Amber header on Plus state communicates elevated caution without a separate warning page.
- Re-check passed: yes. Non-technical operator sees a clear title, a compact impact preview (three rows: current, new, count), and a timing note that reassures them nothing breaks mid-flight. On Plus tier, the amber header signals "this needs more attention." The checkbox is a deliberate single action; the primary button label "Make Plus the default" is specific and self-describing.

**Rule violations flagged:** none. No em-dashes anywhere. Amber tint reserved for Plus-tier caution state only; standard sanctioned-tier modal uses clean white header. Primary action disabled by default on Plus until acknowledged (disclosure-required fields default to unchecked per the brief). Cancel always visible and never hidden. Agent tooltip uses hover (lowest-weight progressive disclosure pattern per the doc). Impact preview surfaces blast radius: current default, new default, affected agent count, timing. Copy avoids "Operator Controller" standalone: pairs it with "autonomous, long-running agent tasks (Operator Controller runs, Phase 3+)" on first use.

**Files modified:**
- `prototypes/operator-session-identity/17-make-default-confirm.html` (CREATED)
- `prototypes/operator-session-identity/01-connections-list.html` (updated: "Make default" 3-dot items linked to screen 17)
- `prototypes/operator-session-identity/04-subscription-detail.html` (updated: prototype note added below Default subscription section)
- `prototypes/operator-session-identity/index.html` (updated: subtitle, r11-badge style, screen 17 entry in Shared section)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 10 — 2026-05-11 22:15
**Operator feedback:** App Integrations grid showed Gmail, HubSpot, and GoHighLevel in BOTH sections: once in "Your connected apps" with a Manage CTA and again in "Browse all apps" with an "Add another" CTA. That is duplication and violates the one obvious entry point per task principle. Fix: exclude already-connected apps from the Browse section entirely. To add a second connection of an already-connected app, the user clicks Manage on the connected card, which opens the multi-connect drawer (screen 16) with its existing "+ Add another Gmail" CTA.

**Changes made:**
- `01b-app-integrations-tab.html`:
  - Removed Gmail, HubSpot, and GoHighLevel cards from the Browse section entirely. These three apps appear only in "Your connected apps" with Manage CTAs.
  - Browse section now contains exactly six unconnected-only cards: Slack (Communication), Teamwork (Project Management), Google Drive (File Storage), Outlook (Communication), Google Calendar (Calendar), Microsoft Calendar (Calendar). Every card has only a "Connect" CTA.
  - "Add another" CTA removed from this tab entirely. No card in either section carries "Add another". The only path to add a second connection of an already-connected app is via the Manage drawer (screen 16).
  - Section 2 heading renamed from "Browse all apps" to "Apps you can connect" to accurately reflect that it shows only zero-connection apps.
  - `applyFilters()` JS updated to also hide the Browse section wrapper when category/search filters leave no browse cards visible, matching the existing behavior for the Connected section.
  - `card-cta-secondary` CSS class left in stylesheet (was used for "Add another" buttons, now unused on this page, kept to avoid breaking anything that may share the class).
  - Tab count chip for App Integrations remains [3], representing the 3 connected apps in "Your connected apps" section.
  - Comment block updated to Round 10 with explanation of the single-entry-point fix.

**Frontend-design-principles checks:**
- Start with primary task: yes. The Browse section's primary task is "connect a new app." Only unconnected apps appear there, so every card's CTA is "Connect" with no ambiguity. The connected apps' task ("manage or add another connection") has a single entry point via the Manage drawer.
- Default to hidden: yes. No new panels, no dashboards, no cost tiles. "Add another" CTA is not hidden but removed: it does not belong on this tab at all; the Manage drawer is its correct and only home.
- One primary action: yes. Browse section: each card has one CTA, "Connect". Connected section: each card has one CTA, "Manage". No card has two competing CTAs. No "Add another" duplicating the Manage path.
- Inline state: yes. Status pill ("Not connected" in grey) inline on every Browse card. Status pill ("N connected" in green) inline on every Connected card. No dashboard or count table needed.
- Re-check passed: yes. Non-technical operator sees "Your connected apps" (what I already use) and "Apps you can connect" (what I can add). There is no confusion about where to click to add a brand-new app vs. managing an existing one. The two sections are clearly distinct with no overlap.

**Rule violations flagged:** none. Duplication bug fixed. Single entry point per task enforced. No "Add another" on Browse section. No em-dashes.

**Files modified:**
- `prototypes/operator-session-identity/01b-app-integrations-tab.html` (Browse section rewritten: connected apps removed, section heading updated, JS updated, comment block updated)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 9 — 2026-05-11 21:30
**Operator feedback:** Round 8 used data-model labels (OAuth, API Key, MCP, Cookie) as user-facing vocabulary. The table with an "Auth" column is a data-model leak. Users don't care what auth method an app uses. Fix: split /connections into three intent-organised tabs (App Integrations card grid, Web Logins table, AI Subscriptions table), per-app modals using the app's own vocabulary, multi-connect Manage drawer, sort + filter affordances on tables, delete the generic chooser (screen 09).

**Changes made:**
- `09-add-connection-chooser.html` (DELETED): The generic "pick an auth method" chooser is the wrong UX. Each tab has its own per-purpose entry point.
- `01-connections-list.html` (updated):
  - Tab strip changed from 2 tabs (Tool Integrations, AI Subscriptions) to 3 tabs (App Integrations [3], Web Logins [3], AI Subscriptions [3]).
  - AI Subscriptions tab remains active on this file. Count chips updated.
  - Sort indicators added to Name (active asc), Provider/Plan (sortable + filterable), Status (sortable + filterable), Last sync (sortable). Filter funnel icons on Provider, Status, Owner columns.
  - Owner column added to AI Subscription table with WorkspaceBadge treatment.
  - Nav hints updated to cross-link 01b and 01c.
  - Sort JS: cycles asc/desc/none per column; updates arrow fill colours inline.
- `01b-connections-tools-tab.html` (REPLACED by `01b-app-integrations-tab.html`):
  - Complete rewrite. Card grid layout, NOT a table.
  - Category filter chips above grid: All / Communication / CRM / Marketing / File Storage / Project Management / Calendar. JS-powered filter + app name search.
  - Section 1 "Your connected apps": Gmail (2 connected, Manage), HubSpot (1 connected, Manage), GoHighLevel (1 connected, Manage). Cards only render if N>0.
  - Section 2 "Browse all apps": 9 cards (Gmail, Slack, HubSpot, GoHighLevel, Teamwork, Google Drive, Outlook, Google Calendar, Microsoft Calendar). CTAs: "Connect" (not connected) or "Add another" (already connected).
  - No mention of OAuth, API Key, MCP, Cookie anywhere. Auth method is not surfaced.
  - Card hover: slight elevation (translateY -2px) + indigo shadow.
  - "Manage" on Gmail card links to 16-manage-multi-connect.html. "Add another" on Gmail links to 10-connect-app-gmail.html.
- `01c-web-logins-tab.html` (NEW):
  - Web Logins tab active. Sortable and filterable table.
  - Above table: title area + explainer ("Username and password credentials for sites that don't have an integration. Used by browser automation for paywalled portal logins.") + "+ Add Web Login" button right-aligned.
  - Columns: Label (sortable, active asc), Site (sortable + filterable), Username (sortable), Status (sortable + filterable), Last tested (sortable), Owner (filterable), Actions.
  - Sort indicators: visible up/down arrows with active colour (#4338ca) on the active column; muted (#cbd5e1) on inactive. Filter funnel icons on Site, Status, Owner.
  - Three sample rows: 42 Macro paywall (Tested OK, green dot), Bloomberg portal (Test failed, red dot with hover tooltip "Login form not found at the configured selector"), Internal admin portal (Untested, grey dot).
  - Three-dot menus: Test / Edit / Disconnect (Disconnect in red).
- `10-add-oauth.html` (DELETED), `10-connect-app-gmail.html` (NEW):
  - Per-app Gmail modal. Title "Connect Gmail". No mention of "OAuth" anywhere.
  - Body copy explains agents can read, draft, send mail.
  - Optional Label field ("Show as"), hint: useful when more than one Gmail account.
  - Primary action "Continue to Google". Note below: "Google will ask you to sign in and confirm permissions."
  - "What we'll access" disclosure section collapsed by default; expands to 4 plain-English bullets (read messages, send messages, manage labels, view settings). No OAuth scope strings.
  - State B: pending overlay with spinner after clicking Continue.
- `11-add-api-key.html` (DELETED), `11-connect-app-hubspot.html` (NEW):
  - Per-app HubSpot modal. Title "Connect HubSpot". Uses HubSpot's own term "Private App Token".
  - Token field: masked, show/hide toggle. Help note links to HubSpot Settings path.
  - Optional Label field. Primary action "Save and test". Note: "We'll connect and run a quick check."
  - Inline result block: alternates error/success per click for demo. No mention of "API Key".
- `16-manage-multi-connect.html` (NEW):
  - Right-side drawer (420px) opened from "Manage" on Gmail card.
  - Header: Gmail icon, "Gmail connections" title, "2 connections in this subaccount" subtitle.
  - "+ Add another Gmail" CTA in toolbar row.
  - Two connection rows: "Marketing Gmail" (Connected, 2 min ago), "Research Gmail" (Needs re-auth, 5 days ago, amber dot). Each has 3-dot menu: Test / Edit label / Disconnect. Re-auth row adds Re-authorise option.
  - Footer note: "To rotate credentials, disconnect and reconnect. Gmail connections use Google sign-in; there is no credential to paste or rotate inline."
  - Backdrop click closes drawer. Close button top-right.
- `index.html` (updated):
  - Title and subtitle updated to reflect 16 screens + Round 9 restructure.
  - New walkthrough order: Connections entry (01, 01b, 01c), App connect flows (10, 11, 16), Web Login flows (12, 13, 14), AI Subscription flows (02-08), Shared (15).
  - Screen 09 entry removed. Screen 10 and 11 entries replaced with new per-app modal descriptions.
  - Screen 16 entry added with Round 9 badge.
  - Round 9 blue badge style added.

**Frontend-design-principles checks:**
- Start with primary task: yes. App Integrations primary task: "connect an app." The card grid's primary question answered by each card is "is this app connected, and what do I do next?" User never needs to know the auth method to answer that question. Web Logins primary task: "see my web login credentials and add/edit/test them." AI Subscriptions: unchanged from round 7.
- Default to hidden: yes. Auth method (OAuth/API Key/MCP/Cookie) is now completely hidden from user-facing UI. "What we'll access" in Gmail modal defaults collapsed. No dashboards, no cost tiles, no observability panels added.
- One primary action: yes. App Integrations tab: each card has one CTA (Connect or Manage or Add another). Web Logins tab: "+ Add Web Login" is the primary action above the table. Gmail modal: "Continue to Google". HubSpot modal: "Save and test". Multi-connect drawer: "+ Add another Gmail" (with Close as secondary).
- Inline state: yes. Card status pill (green "2 connected", grey "Not connected") inline on each app card. Test-status dots inline in Status column on Web Logins table. Sort indicators inline on column headers. Connection status inline in the multi-connect drawer rows.
- Re-check passed: yes. Non-technical operator landing on App Integrations sees a grid of recognisable app names with clear CTAs. They click "Connect Gmail" and see a modal that says "Continue to Google." No jargon. Web Logins tab shows a clean table; the "+ Add Web Login" button is the only primary action. The drawer for Gmail multi-connect shows exactly two entries with clear status labels.

**Rule violations flagged:** none. No OAuth/API Key/MCP/Cookie labels on any user-facing screen. Per-app vocabulary used (HubSpot "Private App Token", Gmail "Continue to Google"). Sort indicators are visible affordances, not hidden until hover (active column shows coloured arrows always; inactive columns show muted arrows always). Filter funnel icons visible but unobtrusive. No em-dashes. Disclosure section on Gmail modal defaults collapsed. Three-dot menus: 3 items (Test / Edit label / Disconnect) for connected, 4 items (Test / Re-authorise / Edit label / Disconnect) for expired — both under the 6-8 cap.

**Files modified:**
- `prototypes/operator-session-identity/09-add-connection-chooser.html` (DELETED)
- `prototypes/operator-session-identity/10-add-oauth.html` (DELETED)
- `prototypes/operator-session-identity/11-add-api-key.html` (DELETED)
- `prototypes/operator-session-identity/01-connections-list.html` (updated: 3-tab strip, sort/filter on AI Subscriptions, Owner column)
- `prototypes/operator-session-identity/01b-app-integrations-tab.html` (REPLACED: card grid, category filters, no auth-method labels)
- `prototypes/operator-session-identity/01c-web-logins-tab.html` (CREATED: Web Logins tab with sort + filter table)
- `prototypes/operator-session-identity/10-connect-app-gmail.html` (CREATED: per-app Gmail modal)
- `prototypes/operator-session-identity/11-connect-app-hubspot.html` (CREATED: per-app HubSpot modal with "Private App Token")
- `prototypes/operator-session-identity/16-manage-multi-connect.html` (CREATED: multi-connect drawer for Gmail)
- `prototypes/operator-session-identity/index.html` (updated: new order, 16 screens, Round 9 badges)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 8 — 2026-05-11 20:00
**Operator feedback:** Scope expansion authorised: /connections CRUD consolidation absorbs Spec C. Legacy CredentialsTab CRUD to be deprecated; /connections becomes the single CRUD surface for all auth methods. Round 8 designs the consolidated Add/Edit/Test/Disconnect flows for all common auth methods, plus web_login rows with test-status dots on the Tool Integrations tab.

**Changes made:**
- `01b-connections-tools-tab.html` (updated):
  - Tab counts corrected: Tool Integrations [13], AI Subscriptions [3].
  - Added 3 Web Login rows: "42 Macro paywall" (test success, green dot), "Bloomberg portal" (test failed, red dot with hover tooltip showing error text), "Internal admin portal" (untested, grey dot).
  - Added 1 MCP Server row ("Notion MCP") and 1 Cookie row ("Research portal") for completeness.
  - Test-status dot column: inline coloured dot appears in the Status cell for Web Login rows (and future test-capable auth methods). Hover tooltip on each dot shows "Last tested: X" or "Test failed: error message". A small legend below the table explains the three states.
  - Three-dot menus on all rows updated to: Test / Edit / Disconnect (consistent shape). Web Login row menus link to screens 14, 13, 15 respectively.
  - "+ Connect" button links to 09-add-connection-chooser.html.
- `01-connections-list.html` (updated): Tab count chips corrected to Tool Integrations [13] and AI Subscriptions [3].
- `09-add-connection-chooser.html` (created): Modal with card-grid layout. OAuth, API Key, Web Login as prominent primary cards (3-column grid) with icon, name, description, chevron. MCP Server and Cookie as secondary "less common" cards in a 2-column row below a divider. Cancel returns to 01b. Each primary card links to its add flow.
- `10-add-oauth.html` (created): Provider dropdown grouped by category (Action providers / File store providers). Optional Label field. "Authorize with [Provider]" button (label updates dynamically via JS). State B: pending authorization spinner block renders inline after clicking Authorize. Disabled state on button during pending. Back to Chooser / Cancel.
- `11-add-api-key.html` (created): Provider dropdown, optional Label, API Key field (masked, show/hide toggle). "Save and test" primary action. Inline error state: "Saved but test failed: [reason]. The key is stored; you can test again from the row." Demo alternates error/success on successive clicks.
- `12-add-web-login.html` (created): 4 primary fields (Label optional, Login URL required, Username required, Password required masked with show/hide). Advanced expander collapsed by default with explainer banner: "Most logins work without these." 6 schema fields in Advanced: Content URL, Username selector, Password selector, Submit selector, Success selector, Timeout (ms). Primary action: "Save Web Login" with note that testing requires a saved row. Back to Chooser / Cancel.
- `13-edit-web-login.html` (created): Pre-filled Bloomberg portal (last test failed). Test-status strip at top shows failure detail and "Test again" link to 14. Password field: dashed-border with "Leave blank to keep current password" placeholder (activates to normal on focus, resets on blur if empty). Advanced section collapsed by default with pre-filled selector values. Primary action: "Save changes" / Cancel.
- `14-test-web-login.html` (created): Two states. State A: agent picker dropdown (42 Macro paywall context), "Run test" primary action with empty-select validation. State B: spinner replaces body, "Browser is logging in as [Agent]", "View run details" secondary link. JS transitions between states. Both states visible in prototype via the state indicator badge.
- `15-disconnect-confirm.html` (created): Danger icon header. Body explains impact on in-flight runs. Agent allowlist note: "3 agents will lose access." Type-to-confirm input: must exactly match "42 Macro paywall" to enable red Disconnect button (JS-controlled disabled state). Disconnect triggers navigation back to 01b in demo.
- `index.html` (updated): Subtitle updated to 15 screens. AI Subscriptions tab count corrected to [3] in 01b entry description. New section header "Consolidated /connections CRUD (Spec C scope expansion, Round 8)" with amber-tinted number badges for screens 09-15. Descriptions added for all new screens. 01b description updated.

**Frontend-design-principles checks:**
- Start with primary task: yes. Each modal has exactly one task: choose auth method (09), authorise OAuth (10), save API key (11), save web login (12), edit web login (13), run test (14), confirm disconnect (15). The test-status dot on 01b rows answers "did the last test pass?" without any extra navigation.
- Default to hidden: yes. Advanced section in 12 and 13 is collapsed by default. No dashboards, no cost tiles, no observability panels. Test-status dots are inline signals (the lowest-weight progressive disclosure pattern per the doc). Pending state in 10 is inline, not a new screen.
- One primary action: yes. 09: selecting a card is the action (no competing CTAs). 10: "Authorize with Provider". 11: "Save and test". 12: "Save Web Login". 13: "Save changes". 14: "Run test" (State A). 15: "Disconnect" (danger, gated). Cancel/Back are never competing primary actions.
- Inline state: yes. Test-status dots inline in the Status cell. Pending spinner inline in the OAuth modal (no new page). Inline test-result block in API Key modal. Test-status strip inline at top of Edit modal. Running state replaces modal body inline (no navigation).
- Re-check passed: yes. Non-technical operator clicking "+ Connect" sees a clean 3-card chooser. Each card is self-describing. The Web Login modal has 4 fields visible by default; Advanced is hidden until needed. The Disconnect confirm has a single destructive action gated behind type-to-confirm. The Test modal asks for one thing: which agent.

**Rule violations flagged:** none. The brief explicitly requested all screens as delivered. No KPI tiles, no dashboards, no em-dashes in UI copy, no "identity" terminology. Password fields masked with show/hide. Type-to-confirm on destructive disconnect. Advanced expanders collapsed by default. Three-dot menus are 3 items (Test / Edit / Disconnect), well under the 6-8 cap.

**Files modified:**
- `prototypes/operator-session-identity/01-connections-list.html` (tab count chips corrected: Tool Integrations 13, AI Subscriptions 3)
- `prototypes/operator-session-identity/01b-connections-tools-tab.html` (updated: web_login rows, test-status dots, MCP/Cookie rows, count chips, "+ Connect" links to 09)
- `prototypes/operator-session-identity/09-add-connection-chooser.html` (created)
- `prototypes/operator-session-identity/10-add-oauth.html` (created)
- `prototypes/operator-session-identity/11-add-api-key.html` (created)
- `prototypes/operator-session-identity/12-add-web-login.html` (created)
- `prototypes/operator-session-identity/13-edit-web-login.html` (created)
- `prototypes/operator-session-identity/14-test-web-login.html` (created)
- `prototypes/operator-session-identity/15-disconnect-confirm.html` (created)
- `prototypes/operator-session-identity/index.html` (updated: 15 screens, new CRUD section header, descriptions, count chips)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 7 — 2026-05-11 18:30
**Operator feedback:** (A) The round-4 decision to merge AI Subscriptions into a single mixed table was wrong. These are architecturally different (model access vs tool access) and should not read as siblings. Add a tab strip to /connections. (B) Failover policy is now locked in Spec C. Update all explainer copy across screens 01, 04, 08 to match the locked wording. (C) Update index.html walkthrough for new 01b file.

**Changes made:**
- `01-connections-list.html`: Tab strip added to /connections page.
  - Tab strip: Tool Integrations [8] (inactive, links to 01b) + AI Subscriptions [2] (active, bold + indigo underline).
  - AI Subscriptions tab is the default render. Tool Integration rows removed from this file.
  - Table now shows only AI Subscription rows (3 rows: ChatGPT Pro Marketing as Default, ChatGPT Plus Marketing as Also allowed, ChatGPT Team Sandbox as Also allowed). Table columns simplified to Name, Provider, Status, Last sync, Actions (Auth method column removed as redundant when all rows are AI Subscriptions).
  - Explainer banner copy updated to locked failover policy: "When an Operator Controller run is dispatched (Phase 3+), the router uses the subaccount default AI Subscription first. If it's unavailable, the router tries the next allowed subscription in alphabetical order, then falls back to platform-managed providers."
  - "+ Connect AI Subscription" CTA moved from header actions to tab-scoped toolbar row above the table.
  - Header actions row now holds only ViewModeSwitcher + search box (shared chrome across both tabs).
  - Nav hints updated: cross-link to 01b.
- `01b-connections-tools-tab.html`: Created (NEW). Tool Integrations tab active. 8 sample rows: Gmail OAuth, GoHighLevel OAuth, Slack OAuth, HubSpot API Key, Airtable API Key, Notion OAuth, Zapier Webhook, Make API Key. Primary CTA: "+ Connect" (dark button, distinct from AI Subscription tab). Tab strip shows Tool Integrations as active with indigo underline; AI Subscriptions tab links back to 01. Same shared chrome (page title, ViewModeSwitcher, search box, scope badge). Reference file only.
- `04-subscription-detail.html`: "Currently used by" section copy replaced with locked failover policy wording:
  - "When Operator Controller runs ship (Phase 3+), this is the first subscription the router picks for any agent in this subaccount that's allowlisted to it. If it becomes unavailable (revoked, disabled, needs re-auth, or rate-limited), the router will try the next allowed AI Subscription for the agent in alphabetical order, and ultimately fall back to platform-managed providers."
  - Phase 3+ empty-state copy retained: "No agents are using this subscription yet. Operator Controller agents ship in Phase 3+."
  - Router footer note (the redundant one below used-by) removed; failover detail now lives in the used-by body copy, not a separate footer. This avoids the explainer-banners rule violation of repeating the same content in both a section body and a footer note.
  - "Default subscription" sub-copy updated: "The router picks this subscription first for Operator Controller runs in this subaccount (Phase 3+)."
- `08-agent-edit-model-access.html`: Router footer note updated to locked failover wording:
  - "The router picks the subaccount default first, then other allowed AI Subscriptions in alphabetical order if the default is unavailable, then platform-managed providers as final fallback. Operator Controller runs that consume this policy ship in Phase 3+."
  - Non-default allowlist row sublabel updated: "Used if the default is unavailable; tried in alphabetical order among allowed subscriptions."
- `index.html`: Updated to reflect new file structure.
  - Screen 01 description updated to describe tab strip and AI Subscriptions tab.
  - Screen 01b added as sibling reference entry (labelled reference, muted styling).
  - Screen 04 description updated to name locked failover policy copy.
  - Screen 08 description updated to name locked failover policy in footer note.
  - Subtitle updated: "Nine screens" and describes tab strip.

**Frontend-design-principles checks:**
- Start with primary task: yes. Screen 01 primary task on the AI Subscriptions tab is "see which AI Subscription is the router default and manage it." The tab strip makes it clear this is a distinct set of connections. The Default row visual hierarchy answers the "which one runs?" question within 2 seconds. Screen 01b primary task is "see tool integrations and connect a new one." Each tab has a clear, distinct primary action.
- Default to hidden: yes. Tab counts are small chips (not KPI tiles). Explainer banner is dismissable. No new dashboards, cost panels, or monitoring elements introduced. The tab strip is structural chrome, not data model exposure.
- One primary action: yes. AI Subscriptions tab: "+ Connect AI Subscription" (indigo, above table). Tool Integrations tab: "+ Connect" (dark, above table). Both are tab-scoped, not shared across tabs.
- Inline state: yes. Tab active indicator (underline + bold + chip turns indigo) communicates current tab state inline without any additional panels. Default row hierarchy preserved from round 6. Failover policy copy is inline in the "Currently used by" section, not in a separate dashboard.
- Re-check passed: yes. Non-technical operator lands on Connections, sees two tabs clearly labelled, AI Subscriptions tab is active. The dominant Default row is visible immediately. The explainer banner names the router policy. Switching to Tools tab (01b) shows 8 tool rows with "+ Connect" as the primary action.

**Rule violations flagged:** none. The round-4 decision to remove tabs is now reversed at operator direction. The brief explicitly calls for a tab strip and names it as architecturally correct per Spec C §6.6.

**Files modified:**
- `prototypes/operator-session-identity/01-connections-list.html` (tab strip added, AI Subscriptions tab active, tool rows removed, banner copy updated to locked policy)
- `prototypes/operator-session-identity/01b-connections-tools-tab.html` (created)
- `prototypes/operator-session-identity/04-subscription-detail.html` (currently-used-by copy updated to locked failover policy, redundant footer note removed, default-sub section sub-copy updated)
- `prototypes/operator-session-identity/08-agent-edit-model-access.html` (router footer note updated to locked policy, non-default sublabel updated)
- `prototypes/operator-session-identity/index.html` (01b added as reference entry, descriptions updated for 01/04/08, subtitle updated)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)


## Round 6 — 2026-05-11 17:30
**Operator feedback:** Multiple AI Subscriptions were visually presented as peers, which is architecturally misleading: only ONE is primary at any moment (the subaccount Default). The product value of having multiples is per-agent variance and future failover (Phase 3+). Tighten visual hierarchy so the Default is obviously dominant, non-defaults are "Also allowed", and add explainer copy naming the Phase 3+ policy-deferred reality.

**Changes made:**
- `01-connections-list.html`: Default row visual dominance applied:
  - Added `.ai-sub-default` class to ChatGPT Pro (Marketing) row: 4px indigo accent left-border, `#f5f3ff` background, bold/dark name font.
  - New `.default-pill-dominant` treatment on Default pill: larger (11px, weight 800), stronger contrast (`#3730a3` on `#e0e7ff`, 1.5px border).
  - New `.primary-micro-label` sub-line ("Primary") under the default row name. Removed `conn-sub` email line from default row (the role is load-bearing; the email is not).
  - Non-default AI Subscription rows (ChatGPT Plus, ChatGPT Team Sandbox) now carry `.ai-sub-secondary` class: muted name color (`#64748b`, weight 500), icon opacity reduced, no accent border.
  - New `.also-allowed-label` sub-line ("Also allowed", muted italic 10.5px) replaces `conn-sub` on non-default AI Subscription rows.
  - Three-dot menu for default row confirmed: no "Make default" item (it is already the default).
  - Added dismissable explainer banner above the table (`.explainer-banner`, blue-tinted, `×` close):
    "When Operator Controller ships (Phase 3+), the router uses the subaccount default AI Subscription, unless an agent is allowlisted only to a different one. Failover policy among multiples is finalised when Operator Controller ships."
- `04-subscription-detail.html`: "Currently used by" section rewritten for Default subscription:
  - Subheading note: "Viewing the subaccount default. The router prefers this subscription for all Operator Controller agents in this subaccount."
  - Body copy now explicitly names Default-first precedence: "the router will pick this subscription for any agent in this subaccount that is allowlisted to it, unless that agent is allowlisted only to a different subscription."
  - Phase 3+ empty-state copy preserved: "No agents are using this subscription yet. Operator Controller agents ship in Phase 3+."
  - New router footer note added below the used-by section (consistent with screen 08): "The router picks which subscription runs at execution time. The subaccount default is preferred; others are used only when allowlists narrow the agent's access. Failover policy among multiples is finalised when Operator Controller ships (Phase 3+)."
  - "Default subscription" section sub-copy tightened to reference the router-prefers framing.
- `08-agent-edit-model-access.html`: Operator Controller allowlist section updated:
  - Default row (ChatGPT Pro Marketing) now uses `.allowlist-row-default`: indigo-tinted background, bold dark name, colored sublabel. Default pill retained. Sub-line updated: "Subaccount default. The router picks this for this agent's Operator Controller runs."
  - New `.allowlist-subheading` ("Also allowed for this agent") separates the default from non-default rows.
  - Non-default row (ChatGPT Team Sandbox) now uses `.allowlist-row-secondary`: muted name color, grey icon, opacity 0.85. Sub-line updated: "Picked only if the default is not available to this agent."
  - Router footer note updated to be consistent with screens 01 and 04: "The router picks which subscription runs at execution time. The subaccount default is preferred; others are used only when allowlists narrow the agent's access. Failover policy among multiples is finalised when Operator Controller ships (Phase 3+)."
- Spot-check of screens 02, 03, 05, 06, 07: confirmed no misleading hierarchy references. These are single-subscription lifecycle/wizard screens with no multi-subscription comparison. No changes needed.

**Frontend-design-principles checks:**
- Start with primary task: yes. Screen 01 primary task is "see all connections and identify which AI Subscription the router will use." The visual hierarchy serves that directly: the Default row answers the question within 2 seconds. Screen 04: primary task is "understand this subscription and manage it." The precedence copy is load-bearing context for that task. Screen 08: primary task is "understand which AI Subscriptions this agent can use." The Default-bolded + Also-allowed structure makes that scannable immediately.
- Default to hidden: yes. No new KPI tiles, no cost panels, no dashboards. The explainer banner is dismissable. The "Also allowed" sub-list is in-context information, not a separate panel.
- One primary action: yes. Screen 01: "Connect AI Subscription" is still the only CTA. Screen 04: sidebar actions unchanged. Screen 08: Save footer unchanged, Model Access section contributes nothing to the save.
- Inline state: yes. Default-pill-dominant inline on list row. Primary micro-label inline under row name. Also-allowed label inline under non-default row names. Router note inline below used-by section on screen 04. Allowlist hierarchy inline within the controller block on screen 08.
- Re-check passed: yes. An operator scanning the connections list table sees a clearly-dominant ChatGPT Pro (Marketing) row within 2 seconds. The explainer banner names the router policy. On screen 04 the "Currently used by" copy tells them exactly what "Default" means for routing. On screen 08, the bold Default row with "Subaccount default" sub-line is the first thing they see in the allowlist.

**Rule violations flagged:** none. "Also allowed" is implemented as a sub-line (light, italic, muted), not a pill or badge, consistent with the brief's explicit instruction.

**Files modified:**
- `prototypes/operator-session-identity/01-connections-list.html` (Default row dominance, Also-allowed sub-lines, explainer banner)
- `prototypes/operator-session-identity/04-subscription-detail.html` (precedence copy rewrite in Currently used by + router footer note)
- `prototypes/operator-session-identity/08-agent-edit-model-access.html` (Default-bolded allowlist row, Also-allowed sub-heading, updated router footer note)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 5 — 2026-05-11 16:30
**Operator feedback:** Screen 08 (agent edit model access) was misleading: (1) the radio picker implied the whole agent runs on ChatGPT Pro when selected, which is architecturally wrong — Native Controller runs are always platform-managed; only Operator Controller runs can use AI Subscriptions. (2) The agent doesn't pick; the router picks at runtime within the policy envelope. Replace the picker with a read-only policy summary panel split by controller style. Index page description for screen 08 to be updated. Terminology sweep on all 8 screens.

**Changes made:**
- Rewrote `08-agent-edit-model-access.html` completely:
  - Removed all radio buttons, picker options, picker JS, selectPicker() and savePicker() functions.
  - Updated explainer banner copy: "Model Access shows where this agent's runs draw intelligence from. It is read-only here. Configuration happens per AI Subscription on the Connections page: open a subscription and edit its availability to control which agents can use it." Dismissable X retained.
  - Added two visually distinct read-only controller-style sub-sections using separate `.controller-block` cards:
    - "Native Controller runs" block (muted grey background): single read-only row showing "Platform-managed providers (OpenAI, Anthropic, Gemini)" with an "Always" locked pill. Sub-line: "Deterministic, structured, short-lived workflows. Default for most tasks." Value hint: "Billed through Spending. Not configurable at the agent level."
    - "Operator Controller runs" block (subtle violet tint, visually distinct): Phase 3+ pill on heading. Sub-line: "Autonomous, adaptive, long-running workflows. Used only when ambiguity, investigation, or persistence is required." Body has "Allowed AI Subscriptions for this agent" heading, two read-only allowlist rows (ChatGPT Pro (Marketing) with Default pill and "Subaccount default" sublabel, ChatGPT Team (Sandbox)). Tier badges inline on rows.
  - Source note below allowlist: "Allowed AI Subscriptions are determined by each subscription's availability setting on the Connections page." With "Edit availability via Connections" link out.
  - Router footer note below both blocks: "The router picks which path runs at execution time, based on the controller style of each run and the agent's policy envelope. It is not configured per agent."
  - Save/Cancel footer retained for global agent edit save; section contributes nothing to save (no section-level save action).
  - Removed all interactive styles from content rows (no cursor:pointer, no hover states, no borders that look clickable).
- Updated `index.html`:
  - Changed page title from "Operator Session Identity" to "AI Subscriptions (Spec C)" to remove user-facing "identity" from the index.
  - Removed stale reference to "All 'identity' terminology replaced with 'subscription'" in screen 04 description.
  - Updated screen 08 entry: section label changed from "Agent edit (per-agent model picker)" to "Agent edit (model access policy)". Description rewritten to reflect read-only policy summary shape.
  - Round badge updated from "NEW Round 4" to "Round 5" on screen 08.
- Terminology sweep (screens 01-07): confirmed all user-facing copy already uses "AI Subscription" / "subscription". CSS class names `.conn-identity`, `.identity-strip` are internal code, not user-facing text, and are left unchanged. No user-facing "identity" copy found in screens 01-07.

**Frontend-design-principles checks:**
- Start with primary task: yes. Screen 08's primary task is "edit the agent's settings." Model Access is informational context, not a task. The section correctly surfaces only what the agent CAN use, not a configuration action. Primary action for the page is still Save (global agent edit).
- Default to hidden: yes. No dashboards. No cost tiles. No runtime metrics. Phase 3+ label is honest about availability. The empty-allowlist state (shown in spec copy) would clearly say "No AI Subscriptions available; router will fall back."
- One primary action: yes. The page's single primary action is Save in the footer, for global agent edit. Model Access contributes nothing to the save and has no internal primary action. The "Edit availability via Connections" link is a navigation affordance, not a primary action on this screen.
- Inline state: yes. Default pill inline on the allowlist row. Tier badges inline. "Always" locked pill inline on the Native block header. Phase 3+ pill inline on the Operator block header.
- Re-check passed: yes. Non-technical operator lands on Model Access and sees two clearly-labelled read-only panels. Nothing invites action except the exit link to Connections. The section reads as informational, not configurable. The router note at bottom explains why there is nothing to configure here.

**Rule violations flagged:** none. The Phase 3+ pill and read-only treatment are both honest and explicitly required by the brief.

**Files modified:**
- `prototypes/operator-session-identity/08-agent-edit-model-access.html` (rewritten: picker dropped, read-only policy summary with controller-style split)
- `prototypes/operator-session-identity/index.html` (screen 08 description updated, title updated, stale terminology note removed)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 4 — 2026-05-11 15:30
**Operator feedback:** Three push-backs on round 3: (1) the tab strip doesn't exist in the real /connections page — drop it, collapse to a single mixed table; (2) rename "identity" to "subscription" everywhere in UI copy; (3) the per-agent picker (agent-side: which subscription does this agent use?) was never drawn — add it as a new screen, clearly marked Phase 3+.

**Changes made:**
- Deleted `01-connections-tools-tab.html` and `02-connections-identities-tab.html` (tab strip never existed in real page).
- Created `01-connections-list.html`: Single flat table reflecting the real /connections page. 8 mixed rows (Gmail OAuth, GoHighLevel OAuth, Slack OAuth, HubSpot API Key, Airtable API Key, ChatGPT Pro AI Subscription with Default pill, ChatGPT Plus AI Subscription with amber needs-consent chip, ChatGPT Team AI Subscription with amber needs-reauth dot). No tab strip. Header: ViewModeSwitcher (Workspace/Org toggle) + search box + "Connect AI Subscription" primary CTA. Workspace scope badge. Provider cell carries plan-tier badge inline for AI Subscription rows. Plus tier row visually warm/amber. AI Subscription rows lightly highlighted. 3-dot menus: AI Subscription rows get: View details, Edit availability, Re-auth, Make default, Transfer ownership, Revoke (danger). Non-AI rows keep existing actions.
- Renamed and updated `02-connect-wizard.html` (from 03): Title "Connect AI Subscription". Subtitle updated to explain AI Subscription concept. Breadcrumb: Connections / Connect AI Subscription. "Save subscription" replaces "Save identity". Links updated.
- Renamed and updated `03-disclosure-plus.html` (from 04): Breadcrumb: Connections / Connect AI Subscription / Consent required. All "identity" replaced with "subscription". "Save subscription" button. Cancel links to 01.
- Created `04-subscription-detail.html` (renamed from 05-identity-detail): Title "AI Subscription: ChatGPT Pro (Marketing)". Breadcrumb: Connections / ChatGPT Pro (Marketing) (no intermediate identities segment). "Subscription details" section label. "Default subscription" section. "Available for agent use" availability section. "Currently used by" Phase 1 copy unchanged. All "identity" copy replaced with "subscription". Revoke → "Revoke subscription". Back link → Connections.
- Created `05-reauth-state.html` (renamed from 06): Breadcrumb: Connections / ChatGPT Team (James R.). Banner: "This AI Subscription needs re-authentication to keep working." Terminology updated.
- Created `06-offboarding-state.html` (renamed from 07): Breadcrumb: Connections / ChatGPT Pro (David K.). Banner: "The original owner of this AI Subscription is no longer active. Transfer ownership or re-auth under an active account to restore it." Terminology updated.
- Created `07-availability-edit.html` (renamed from 08): Title "Edit availability: ChatGPT Pro (Marketing)". Sub-header "Choose which agents can use this AI Subscription." Breadcrumb: Connections / ChatGPT Pro (Marketing) / Edit availability. Terminology updated throughout.
- Created `08-agent-edit-model-access.html` (NEW): Agent edit page chrome with left-rail nav (Profile, Role, Memory, Skills, Model Access active, Permissions). "Phase 3+ placeholder" pill on section header. Dismissable explainer banner explaining runtime mode. Radio picker with 4 options: Platform-managed (default, selected), ChatGPT Pro Marketing (Pro badge, "Available to this agent"), ChatGPT Team Sandbox (Team badge), ChatGPT Plus Marketing (disabled, dashed border, "Needs consent" warning chip). Availability note at bottom linking to Connections. Save/Cancel footer. JS: clicking disabled row does nothing; Save confirms with honest Phase 3+ message.
- Updated `index.html`: Removed two old tab screens, updated all descriptions to reflect round 4 changes. Section label "AI Subscription detail and lifecycle". New section "Agent edit (per-agent model picker)" with screen 08. New green "NEW Round 4" badge on 08.
- Deleted old round-3 files: 03-connect-wizard.html, 04-disclosure-plus.html, 05-identity-detail.html, 06-reauth-state.html, 07-offboarding-state.html, 08-availability-edit.html.

**Frontend-design-principles checks:**
- Start with primary task: yes. 01: "see all connections and find the AI Subscriptions". 02: "connect a new ChatGPT plan". 03: "accept Plus disclosure or cancel". 04: "understand this subscription and manage it". 05: "re-authenticate this subscription". 06: "resolve the orphaned subscription". 07: "edit which agents can use this subscription". 08: "choose which intelligence source this agent uses". Each screen's primary task drives layout.
- Default to hidden: yes. No KPI tiles. No usage dashboards. No cost panels. Phase 3+ picker on 08 is clearly labelled as not-runtime-active; its content is minimal (4 options, one note). Tab strip removed entirely.
- One primary action: yes. 01: "Connect AI Subscription". 02: "Connect with OpenAI" button (then "Save subscription" in state B). 03: type-to-accept then "Save subscription". 04: no competing CTA on body; actions in sidebar equal-weight. 05: "Re-authenticate now" banner CTA. 06: "Transfer ownership" banner CTA. 07: "Save" footer. 08: "Save" footer.
- Inline state: yes. Default pill on 01 table rows and 04 detail header. Tier badges inline in provider cell on 01. Needs-consent chip inline on Plus row. Status dots on all rows. Phase 3+ pill on 08 section header. Phase 1 note box on 04 "Currently used by" section.
- Re-check passed: yes. Non-technical operator on 01 sees a single table; "Connect AI Subscription" is the only new-primary-action button. AI Subscription rows visually distinct via slight highlight and purple "AI Subscription" auth-method pill. 08 is honest: explainer banner + Phase 3+ pill makes it clear this is a future feature being configured ahead of time.

**Rule violations flagged:** none. The Phase 3+ placeholder on screen 08 is intentional and explicitly called out to the operator; it doesn't violate the rules (it's a forward-config screen, not a hidden capability presented as live).

**Files modified:**
- `prototypes/operator-session-identity/01-connections-tools-tab.html` (deleted)
- `prototypes/operator-session-identity/02-connections-identities-tab.html` (deleted)
- `prototypes/operator-session-identity/03-connect-wizard.html` (deleted, replaced by 02-connect-wizard.html)
- `prototypes/operator-session-identity/04-disclosure-plus.html` (deleted, replaced by 03-disclosure-plus.html)
- `prototypes/operator-session-identity/05-identity-detail.html` (deleted, replaced by 04-subscription-detail.html)
- `prototypes/operator-session-identity/06-reauth-state.html` (deleted, replaced by 05-reauth-state.html)
- `prototypes/operator-session-identity/07-offboarding-state.html` (deleted, replaced by 06-offboarding-state.html)
- `prototypes/operator-session-identity/08-availability-edit.html` (deleted, replaced by 07-availability-edit.html)
- `prototypes/operator-session-identity/01-connections-list.html` (created)
- `prototypes/operator-session-identity/02-connect-wizard.html` (created)
- `prototypes/operator-session-identity/03-disclosure-plus.html` (created)
- `prototypes/operator-session-identity/04-subscription-detail.html` (created)
- `prototypes/operator-session-identity/05-reauth-state.html` (created)
- `prototypes/operator-session-identity/06-offboarding-state.html` (created)
- `prototypes/operator-session-identity/07-availability-edit.html` (created)
- `prototypes/operator-session-identity/08-agent-edit-model-access.html` (created)
- `prototypes/operator-session-identity/index.html` (updated)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 3 — 2026-05-11 14:00
**Operator feedback:** "The AI and Models hierarchy doesn't exist in the app today. The existing /connections page is the right home. Delete page 00, re-chrome everything into /connections with a tab strip: Tool Integrations and Operator Session Identities."

**Changes made:**
- Deleted `00-ai-and-models-index.html` (AI and Models landing no longer exists in this build).
- Deleted old round-1/2 numbered files (01-identities-list, 02-connect-wizard-handshake, 03-disclosure-plus, 04-identity-detail, 05-reauth-state, 06-offboarding-state, 07-availability-edit) — all replaced by renumbered round-3 versions.
- Created `01-connections-tools-tab.html`: Connections page with Tool Integrations tab active. Four sample rows (Gmail OAuth, GoHighLevel OAuth, Slack OAuth, HubSpot API Key). Tab strip with count chips (8/2). View-mode badge (Workspace: Marketing subaccount). Sidebar: Organisation group, Connections link active.
- Created `02-connections-identities-tab.html`: Connections page with Operator Session Identities tab active. Identity rows from round 2 (default pill, availability badge, 3-dot menu). Subaccount default status bar. Phase 1 note. "Connect ChatGPT plan" primary CTA. Same sidebar/tab structure.
- Created `03-connect-wizard.html`: Renamed from 02-connect-wizard-handshake. Breadcrumb updated to Connections / Operator Session Identities / Connect ChatGPT plan. Cancel links to 02-connections-identities-tab. Save identity links to 05-identity-detail.
- Created `04-disclosure-plus.html`: Renamed from 03-disclosure-plus. Breadcrumb updated to Connections / Operator Session Identities / Connect ChatGPT plan / Consent required. Links updated.
- Created `05-identity-detail.html`: Renamed from 04-identity-detail. Breadcrumb: Connections / Operator Session Identities / Sarah M. (ChatGPT Pro). Sidebar "Connections" active. Back link goes to 02-connections-identities-tab. Master switch toggle relabelled: "Available for agent use" (was "Allow agents to use this identity at runtime"). Revoke redirects to 02-connections-identities-tab.
- Created `06-reauth-state.html`: Renamed from 05-reauth-state. Breadcrumb: Connections / Operator Session Identities / James R. (ChatGPT Team). Links updated.
- Created `07-offboarding-state.html`: Renamed from 06-offboarding-state. Breadcrumb: Connections / Operator Session Identities / David K. (ChatGPT Pro). Links updated.
- Created `08-availability-edit.html`: Renamed from 07-availability-edit. Breadcrumb: Connections / Operator Session Identities / Sarah M. (ChatGPT Pro) / Edit availability. Links to 05-identity-detail.
- Updated `index.html`: Removed page 00 entry. Updated all screen numbers, titles, and descriptions to reflect round-3 renaming. Walkthrough order: 01 to 02 to 03 to 04 to 05 to 06 to 07 to 08.

**Frontend-design-principles checks:**
- Start with primary task: yes. 01 task is "see existing connections and navigate to identities tab". 02 task is "see all session identities and connect a new one". 03: "connect with OpenAI". 04: "accept or decline Plus terms". 05: "understand this identity and manage it". 06: "re-authenticate this identity". 07: "resolve the orphaned identity". 08: "edit which agents can use this identity". Each screen's primary task drives the layout.
- Default to hidden: yes. No KPI tiles anywhere. No usage dashboards. No cost panels. Tab strip is structural, not a data-model dump. View-mode badge is single-line, load-bearing (shows scope). Tool Integrations tab is sketched lightly (4 rows) without over-engineering non-scope content.
- One primary action: yes. 01: "Add connection" (Tool Integrations tab). 02: "Connect ChatGPT plan". 03: "Connect with OpenAI" button. 04: type-to-accept then Submit. 05: no competing CTA on body, Re-authenticate in sidebar is equal weight with Transfer/Revoke. 06: "Re-authenticate now" banner CTA. 07: "Transfer ownership" banner CTA. 08: "Save" footer.
- Inline state: yes. Default pill on list rows and detail header. Availability badge on list rows. Usability pills inline. Phase 1 note box below table. Tab count chips. View-mode badge. No dashboards.
- Re-check passed: yes. Non-technical operator landing on 01 sees "Connections" page with two clear tabs and sample rows. Clicking "Operator Session Identities" tab (02) sees the identity list with a clear "Connect ChatGPT plan" CTA. All detail pages have prominent action buttons. Banners on re-auth and offboarding states tell the operator exactly what to do.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/operator-session-identity/00-ai-and-models-index.html` (deleted)
- `prototypes/operator-session-identity/01-identities-list.html` (deleted, replaced by 02-connections-identities-tab.html)
- `prototypes/operator-session-identity/02-connect-wizard-handshake.html` (deleted, replaced by 03-connect-wizard.html)
- `prototypes/operator-session-identity/03-disclosure-plus.html` (deleted, replaced by 04-disclosure-plus.html)
- `prototypes/operator-session-identity/04-identity-detail.html` (deleted, replaced by 05-identity-detail.html)
- `prototypes/operator-session-identity/05-reauth-state.html` (deleted, replaced by 06-reauth-state.html)
- `prototypes/operator-session-identity/06-offboarding-state.html` (deleted, replaced by 07-offboarding-state.html)
- `prototypes/operator-session-identity/07-availability-edit.html` (deleted, replaced by 08-availability-edit.html)
- `prototypes/operator-session-identity/01-connections-tools-tab.html` (created)
- `prototypes/operator-session-identity/02-connections-identities-tab.html` (created)
- `prototypes/operator-session-identity/03-connect-wizard.html` (created)
- `prototypes/operator-session-identity/04-disclosure-plus.html` (created)
- `prototypes/operator-session-identity/05-identity-detail.html` (created)
- `prototypes/operator-session-identity/06-reauth-state.html` (created)
- `prototypes/operator-session-identity/07-offboarding-state.html` (created)
- `prototypes/operator-session-identity/08-availability-edit.html` (created)
- `prototypes/operator-session-identity/index.html` (updated: flow reordered, page 00 removed, all descriptions updated)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)



## Round 2 — 2026-05-11

**Operator feedback:** "Where in the system are these actually configured? Where are they actually used? Where do you choose which to use? I need mockups around that. Plus the v1.2 architecture brief landed: location moves to Subaccount Settings / AI and Models. Per-identity agent allowlists. Subaccount-level default identity. Phase 1 phasing honesty about no consumers yet."

**Changes made:**
- Created `00-ai-and-models-index.html`: AI and Models landing page. Two sections: Platform Model Providers (3 API-key rows with configured/not-configured status) and Operator Session Identities (preview rows with default pill and availability badges). Dismissable explainer banner. "Manage identities" primary CTA leading to 01.
- Created `01-identities-list.html`: Replaced mixed `01-connections-list.html`. Session identities only. Default pill on row. Availability badge ("All agents" / "3 of 12 agents") per row. Subaccount default status bar above table. 3-dot menu adds Make default and Edit availability. Phase 1 note below table.
- Created `04-identity-detail.html`: Replaces `04-connection-detail.html`. New sections: Subaccount default (blue callout box, Default pill), Availability (current setting + "Edit availability" link to 07), Currently used by (Phase 1 empty state: "No agents are using this identity yet. Operator Controller agents (Phase 3+) will be able to use this once they ship."). Master switch toggle renamed: "Allow agents to use this identity at runtime". "Org admin only" pill retained. Breadcrumb updated.
- Created `07-availability-edit.html`: New screen. Per-identity agent allowlist editor. Identity strip at top (name, plan tier, usability pill). Radio: All agents (default selected) / Specific agents only. When specific selected: checkbox list of 10 mock agents with role chips (Support/Outreach/Content/Research). Selection count badge. Org admin only pill on form card header. Save / Cancel footer.
- Updated chrome on `02-connect-wizard-handshake.html`: Sidebar "Settings / AI and Models", breadcrumb "AI and Models / Operator Session Identities / Connect ChatGPT plan". Links updated to 01-identities-list.html and 04-identity-detail.html.
- Updated chrome on `03-disclosure-plus.html`: Same sidebar/breadcrumb pattern. Cancel links to 01-identities-list. Submit goes to 04-identity-detail.
- Updated chrome on `05-reauth-state.html`: Sidebar/breadcrumb updated. "Identity" terminology throughout. "Currently used by" section with Phase 1 copy. Identity name style "James R. (ChatGPT Team)".
- Updated chrome on `06-offboarding-state.html`: Sidebar/breadcrumb updated. "Identity" terminology throughout. "Currently used by" section with Phase 1 copy. Identity name style "David K. (ChatGPT Pro)".
- Updated `index.html`: New flow order (00, 01, 02, 03, 04, 07, 05, 06). Round 2 badges on new/updated screens. Descriptions updated to reflect new content.

**Frontend-design-principles checks:**
- Start with primary task: yes. 00: "see what AI access is configured". 01: "see all identities and who the default is". 04: "understand this identity and manage it". 07: "edit which agents can use this identity". Each screen's primary task drives the layout.
- Default to hidden: yes. No KPI tiles. No usage dashboards. No cost panels. Availability detail (agent list) hidden behind the "Edit availability" link (separate screen). Advanced controls (master toggle) in sidebar not inline.
- One primary action: yes. 00: "Manage identities" CTA. 01: "Connect ChatGPT plan". 04: first action is Re-authenticate in sidebar (equal weight with Transfer/Revoke, but no competing body CTA). 07: "Save" in footer. 05: "Re-authenticate now" in banner. 06: "Transfer ownership" in banner.
- Inline state: yes. Default pill on list rows and detail header. Availability badge on list rows ("All agents" / "N of M agents"). Usability pill inline. Phase 1 phase-note box on list page. No dashboard for any of this.
- Re-check passed: yes. Non-technical operator on 00 sees two clear sections and a "Manage identities" button. On 01 sees the list with default highlighted and a clear "Connect" CTA. On 07 sees two radio options and a checkbox list. All clear within 3 seconds.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/operator-session-identity/00-ai-and-models-index.html` (created)
- `prototypes/operator-session-identity/01-identities-list.html` (created, replaces 01-connections-list.html)
- `prototypes/operator-session-identity/04-identity-detail.html` (created, replaces 04-connection-detail.html)
- `prototypes/operator-session-identity/07-availability-edit.html` (created)
- `prototypes/operator-session-identity/02-connect-wizard-handshake.html` (chrome updated)
- `prototypes/operator-session-identity/03-disclosure-plus.html` (chrome updated)
- `prototypes/operator-session-identity/05-reauth-state.html` (chrome + terminology updated)
- `prototypes/operator-session-identity/06-offboarding-state.html` (chrome + terminology updated)
- `prototypes/operator-session-identity/index.html` (reordered, descriptions updated)
- `tasks/builds/operator-session-identity/mockup-log.md` (this entry)

## Round 1 — 2026-05-11 (initial draft)

**Operator feedback:** initial draft

**Changes made:**
- Created `prototypes/operator-session-identity/` multi-screen directory
- Created `_shared.css` with design tokens extending `consolidation-2026-05-06/_shared.css`: connection type icons, auth-type labels, plan tier badges (Pro/Team/Enterprise/Plus/unknown), usability state pills (Usable/Needs consent/Needs re-auth/Unverified/Revoked/Disabled), disclosure box, offboarding banner, metadata row layout, admin-only pill, wizard step bar, alert banners
- Screen 1 (`01-connections-list.html`): Govern sidebar, Connections page showing mixed API-key and operator-session rows grouped by section. Visual distinction via conn-icon background colour and `auth-type-label` pill. Plan tier badge on session rows. Usability state pill on all rows. 3-dot menus with Revoke / Re-auth / Transfer ownership. Row click to detail. "James R." row highlighted amber for Needs re-auth state. "Connect ChatGPT plan" primary CTA top right. "Connect API key" secondary button alongside it.
- Screen 2 (`02-connect-wizard-handshake.html`): Wizard with step bar (3 steps). State A: "Connect with OpenAI" button. Clicking shows a spinner overlay (1.8s), then transitions to State B: plan detected card with Pro badge, Verified status, account details. Footer changes to "Save connection" on State B. Note in State B explains the Plus divergence path with link to screen 3.
- Screen 3 (`03-disclosure-plus.html`): Full-page disclosure interrupted before credential is stored. Amber disclosure box with placeholder copy (clearly labelled "pending Legal review"). Type-to-accept field: exact string "I accept the risk" gates the submit button (JS validation). Submit button greyed out until valid. Accepted banner appears inline when valid. Cancel button confirms discard before navigating away. Disclosure version shown in footer of the disclosure text box.
- Screen 4 (`04-connection-detail.html`): Two-column layout (main metadata + sidebar actions). Org admin view (shown in topbar). Identity header with Pro badge and Usable pill. Metadata rows: Provider, plan tier, plan verification (Verified), verified at, usability state, token refreshed. Ownership section: connected by, connected on, scope. Credential access row: "Never visible — broker-internal only". Used by: "None yet" placeholder. Sidebar: Re-authenticate, Transfer ownership, Revoke (danger). Allow runtime use toggle with "Org admin only" pill (visible because viewer is org admin).
- Screen 5 (`05-reauth-state.html`): Same two-column layout as screen 4 but for "James R. — ChatGPT Team". Amber banner at top with primary "Re-authenticate now" CTA. Token lifecycle section shows failure reason chip (`expired_refresh_token`). Re-auth button in sidebar also primary (indigo). Other metadata matches usable state detail layout.
- Screen 6 (`06-offboarding-state.html`): "David K." — deactivated on 8 May 2026. Red offboarding banner explains situation. Usability state shows Disabled pill. Disabled reason in sidebar status card. Deactivated badge on the user's name in Ownership section. Primary actions: Transfer ownership (primary indigo) and Re-auth under my account. Credential access token row retained with broker-only note.
- Created `index.html` linking to all 6 screens with one-line descriptions.

**Frontend-design-principles checks:**
- Start with primary task: yes — list screen task is "see and manage connections"; connect wizard task is "connect the plan"; disclosure task is "accept or decline"; detail task is "understand and act on the credential". Each screen's primary task drives its layout, not the data model.
- Default to hidden: yes — no KPI tiles, no cost-saved counterfactuals, no usage explorer, no run history tables. Token material explicitly hidden. Plan verification status shown only as a small label, not a metric tile.
- One primary action: yes — list: "Connect ChatGPT plan"; wizard state A: "Connect with OpenAI" button; disclosure: type-to-accept then Submit; detail (usable): Re-authenticate is the primary sidebar action framed neutrally (all three actions equally weighted, but no competing primary call-to-action on the page body); re-auth state: "Re-authenticate now" banner CTA; offboarding: "Transfer ownership" primary button in banner.
- Inline state: yes — usability state pills on each list row (status dot + label); plan tier badge inline; failure reason chip inline on token lifecycle section rather than a separate dashboard.
- Re-check passed: yes — non-technical operator landing on the list sees "Connect ChatGPT plan" immediately; detail pages have clear role-appropriate action buttons; banner CTAs on re-auth and offboarding screens tell the operator exactly what action is needed.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/operator-session-identity/index.html` (created)
- `prototypes/operator-session-identity/_shared.css` (created)
- `prototypes/operator-session-identity/01-connections-list.html` (created)
- `prototypes/operator-session-identity/02-connect-wizard-handshake.html` (created)
- `prototypes/operator-session-identity/03-disclosure-plus.html` (created)
- `prototypes/operator-session-identity/04-connection-detail.html` (created)
- `prototypes/operator-session-identity/05-reauth-state.html` (created)
- `prototypes/operator-session-identity/06-offboarding-state.html` (created)
- `tasks/builds/operator-session-identity/mockup-log.md` (created)
