# Sales Reference: "Does each agent get its own VM?"

When a prospect asks whether agents get a dedicated VM or their own compute environment, they are really asking: are agents reliable, isolated, and capable of doing real work? The answer is yes — and the way we deliver it is better than the dedicated-VM model.

Each agent in Automation OS has a persistent named workspace that exists between runs — the agent's identity, what it knows, what it has produced, and its current status are always visible to the operator. When an agent needs to do heavier work — navigating websites, filling forms, running scripts, or executing dev tasks — isolated compute is provisioned on demand for that specific run, used, and then released the moment the task completes. Nothing sits idle. Compute is billed per active minute of work, not as a flat per-agent cost. That means operators pay for actual work done, not for capacity that sits dormant between tasks.

The pitch: a dedicated VM per agent is expensive and wasteful — most agents are not running most of the time. Automation OS gives each agent a permanent home and on-demand horsepower when it is needed, with the invoice reflecting only the time it was actually doing something.
