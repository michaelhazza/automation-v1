# GHL Agency Interview Brief — 180-client agency owner

One-page stress test for our core thesis before we go further down the GHL path.

**Related docs (for deeper context after the call):**
- `tasks/ghl-agency-value-proposition.md` — five pillars, pricing, market sizing
- `tasks/ghl-agency-development-brief.md` — full discovery framework and template defaults
- `tasks/ghl-agency-feasibility-assessment.md` — competitive map and unit economics
- `docs/clientpulse-ghl-dev-brief.md` — soft-launch product definition
- `docs/capabilities.md` — positioning (Core Value Proposition / Competitive Differentiation)

---

## The one thing to stress-test

**Thesis:** A GHL agency at 180 clients has hit a ceiling that GHL itself cannot fix — no cross-sub-account visibility, no safe way to run AI across all clients, no per-client P&L. We are the **operations system that sits on top of GHL**, not a better GHL.

If this agency owner does not feel that ceiling, our GHL wedge is weaker than we think. If they do, we have a design partner.

---

## Value proposition (plain English, one breath)

> You connect GHL once. We auto-discover all 180 sub-accounts. Within an hour you have one dashboard showing every client's health score — pipeline, conversations, revenue — with anomalies flagged before the client notices. AI agents run across every client with approval gates so nothing embarrassing goes out. You see cost and margin per client, so you can sell AI monitoring as a service instead of absorbing the bill.
>
> **One dashboard. All clients. AI that is actually safe to run.**

Four structural things GHL cannot match, no matter what they ship:
1. Cross-sub-account portfolio view with health scoring and anomaly detection
2. Human-in-the-loop approval gates on every AI-driven client action
3. Per-client cost attribution and margin markup (so AI becomes a revenue line)
4. One-click template deployment — configure once, provisioned across all clients

---

## Five questions to ask (in this order)

**1. Monday-morning reality check — validates cross-client visibility gap**
> "Walk me through your Monday morning. Out of 180 clients, how do you figure out which ones need attention this week? What do you log into, what do you read, who on your team tells you what's wrong?"

Listen for: manual log-ins, spreadsheets, "I ask the account managers," "I find out when the client complains." If they say "I have a dashboard that tells me," probe hard — is it real-time, is it cross-client, does it flag anomalies?

**2. The last AI incident — validates AI governance gap**
> "Are you running AI agents for your clients today — chatbots, voice AI, SMS follow-up, booking bots? Tell me about the last time one of those said something wrong, off-brand, or embarrassing. How did you find out? What did it take to stop it happening again?"

Listen for: a specific story. If they cannot describe an incident, either they are not running AI at scale or they are not catching the failures — both are disqualifiers for a design partner. If they have a story and visibly wince, green flag.

**3. The "what did the AI do for me" moment — validates per-client P&L**
> "When a client asks you 'what did your AI actually do for me last month?', what do you send them? Do you know your cost per client on AI, and are you marking it up — or is it a line item you are absorbing?"

Listen for: "we don't really track that per client," "we just bundle it in," "I have no idea what it costs me." That is the margin wedge. If they are already tracking it cleanly, they are either a unicorn or lying.

**4. The willingness-to-pay test — validates commercial case**
> "If I gave you one dashboard showing every client's health score, with anomalies flagged before they noticed, plus approval gates on every AI-driven message, plus per-client margin — what is that worth to you per month? And what would you need to believe to pay for it?"

Listen for: real numbers, not politeness. "A few hundred" means it is a vitamin. "A thousand or two" means it is a painkiller. "I'd pay whatever if it actually worked" means build them a demo this week.

**5. The wand question — lets them surface the real pain**
> "If you could wave a wand and automate one thing across all 180 clients at once — without configuring it 180 times — what would it be? And what has stopped you from doing it so far?"

Listen for: the thing they say is often not what we expected. That is the gold. It tells us whether our five pillars actually map to their felt pain, or whether we have built a solution for a different agency.

---

## What a good call looks like

**Green flags** — pursue as design partner:
- Specific AI-gone-wrong story they can tell
- Admits they cannot see across all 180 clients without effort
- Does not know per-client AI cost, nods when margin is mentioned
- Quotes a four-figure monthly number without flinching
- Willing to connect GHL OAuth to a private-app build

**Red flags** — thank them and move on:
- "GHL AI works fine for us"
- Already built internal dashboards they love
- Cannot describe a single incident
- Treats the conversation as a sales pitch to dodge
- Won't give 30 minutes a week for feedback

---

## What I am listening for overall

One sentence that tells me the thesis is right: *"Yeah, we have no way to see across all our clients at once, and every time we turn AI up it breaks something and we have to turn it back down."*

If I hear that, we have a wedge. If I do not hear anything close to it from a 180-client agency, the GHL path needs a rethink before we build more.
