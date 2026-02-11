# Design Evolution

How Corvus went from a domain-specific prototype to a general-purpose thinking partner.

---

## Origin: A Personal Tool for Venture Planning

Corvus started in January 2026 as a proof-of-concept for a specific problem: planning a new software venture. The original spec imagined a tool that could help a solo developer navigate the decision landscape of starting a company — LLC formation, app store submissions, compliance requirements.

The first build was a Next.js app with two panes: a timeline canvas on the left, a chat sidebar on the right. The chat (Huginn) talked to Claude via the Anthropic API. The timeline visualized entries — obligations, options, decisions — as confidence-weighted bubbles on a vertical spine.

It worked, but it had a rules engine baked in. Curated rules for the "solo dev starting a venture" domain generated inferred entries from facts. The tool knew about LLCs, app stores, and compliance — and nothing else.

## The Core Grammar: Fork, Path, Obligation

The initial data model used a flat list of entries typed as `obligation`, `option`, or `decision`. This broke down immediately. You can't represent "here are three options, pick one" as siblings in a flat list. An option and a decision about that option aren't peers — they're nested.

The fix was hierarchical: **Forks** contain **Paths**. A fork is a decision point. Each path is a possible answer. Choosing a path _is_ the decision — there's no separate decision type, just a path in the `chosen` state.

```
Fork: "Which game engine?"
├── Path: Unity    → chosen
├── Path: Godot    → dismissed
└── Path: Unreal   → open
```

**Obligations** stayed as their own concept — things that must be done, with lifecycle states (`todo`, `done`, `delegated`, `parked`, `won't do`).

This grammar turned out to be universal. Decision points and commitments aren't domain-specific. Every project, in every domain, produces forks and obligations.

A key insight from the same session: decisions should be append-only. Like a financial ledger, you don't go back and edit history. To change a past decision, you append a new decision that references the old one. The history shows the change of mind, not a retroactive edit. This was the moment the "ledger" metaphor became load-bearing, not decorative.

## Real-World Testing: Domain-Agnostic Value

Two early users tested Corvus outside the original domain:

**ISO 45001 compliance planning** — A user at a steel services company had been discussing compliance planning with ChatGPT. The conversations had useful thinking in them, but no structure. She used Corvus for about an hour and produced a structured timeline of decisions and obligations that she manually turned into presentation slides.

**Book writing** — A therapist planning a book had the same experience. Multiple ChatGPT conversations full of decisions about structure, audience, and content — but no way to extract or maintain that structure over time. Corvus immediately surfaced the value.

Neither user cared about LLCs or app stores. They cared about the interaction model: chat naturally, and your decisions crystallize into something durable and visible.

## Generalization: Rules Engine Out, Personas In

The real-world testing made the rules engine indefensible. It was domain-hardcoded, high-maintenance, and unnecessary. The LLM itself is a contextually aware rules engine — it recognizes decision points and obligations in any domain without being told what to look for.

The rules engine was removed entirely. What remained was the universal grammar (Fork/Path/Obligation) and Huginn's role as a thinking partner that _recognizes_ structure rather than _prescribing_ it.

Around the same time, the "modes" concept (greenfield vs. reconstruction) evolved into **personas** — a shift from "what is the system doing" to "how does it engage." A persona affects tone and cadence: a Thinking Partner lets ambiguity sit longer and focuses on exploration; a Strategic Advisor pushes toward resolution faster. The underlying grammar stays the same.

The top-level container was renamed from "Venture" to "Ledger" — domain-neutral language that works for a company plan, a book outline, or a compliance audit.

## Event Sourcing and Time Travel

Every mutation in the ledger emits an event to an append-only event log. The current state is dual-written — both the event log and the materialized state update together. This keeps the app working normally while enabling full state reconstruction from events.

The event log powers time travel: scrub backward through history and see exactly what the timeline, decisions, and conversations looked like at any point. All three panels (Timeline, Muninn, Huginn) reflect the reconstructed state. An amber visual treatment signals you're viewing history, and all inputs are disabled.

The design maintains two separate logs:

- **Events** — a technical audit trail of every mutation (18 event types). Used for time travel reconstruction.
- **Decisions** — the user-facing record in Muninn. Only meaningful choices: path selections and obligation state changes, not every mutation.

A path dismissal is a mutation, not a decision. The user doesn't need "I dismissed Option B" in their decision log — they need "I chose Option A because X."

## Branching and Isolation

Branching uses git semantics: the main ledger is like `main`, and branches are isolated "what-if" explorations. Create a branch from any message or fork, make changes in isolation, then merge back or abandon.

Entry state is snapshotted at branch creation using the same event reconstruction that powers time travel. Messages are copied up to the divergence point. Changes in a branch don't affect the main ledger until explicitly merged.

Merging is append-only. If a branch chose a different path for a fork that was already decided on main, that's a conflict — surfaced visually, resolved by the user, and the resolution itself becomes a recorded decision.

Abandoning a branch isn't deletion — it's an explicit event. The branch stays in the record, hidden from the active conversation picker but visible in history. The full audit trail is preserved.

## Conversational Warmth: Thinking Partner, Not Form Filler

An early problem: Huginn felt transactional and cold. The system prompt constrained responses to 1–3 sentences, framed Huginn as an "extractor" and "recognizer," and wrapped everything in a strict JSON-only output format. The result was an experience described as talking to "a begrudging authoritarian figure with no patience."

The fix was reframing. Huginn isn't an extraction engine — it's a thinking partner. The system prompt was rewritten around relationship, not task:

- Be curious about the user's thinking
- Let ambiguity sit when the user is still exploring
- Surface structure (forks, obligations) when you recognize it — that's your job — but don't constantly offer to "do things"
- Never be pushy. Users who think conversationally will ask for concrete output when they're ready.

This was an explicit counter to the default LLM posture. Most models are trained to be eager helpers that offer next steps after every message. For Corvus, that's the anti-pattern. Recognizing a decision point and surfacing it as a fork is fundamentally different from offering to "write up a summary for you."

## What's Next

Corvus is being developed as a product. The OSS release is a snapshot of the proof-of-concept — a demonstration of the interaction model. The product will be a separate codebase built on the same core ideas: chat as the verb, canvas as the noun, and a durable decision record that captures the structure of thinking.

Areas being explored for the product include richer context management (so the LLM maintains awareness across long conversations), personas that shift dynamically based on conversation flow, collaborative ledgers for teams, and value extraction workflows that help package decisions for external audiences.

The core thesis hasn't changed since day one: people already think with LLMs, but the structure of that thinking disappears. Corvus makes it visible.
