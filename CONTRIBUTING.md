# Contributing

Corvus Ledger is a snapshot of an actively developed project. The maintained version is being built as a commercial product by [Cone Crows LLC](https://github.com/thutch-conecrow).

## What This Means

**Issues and discussions are welcome.** They help shape the product direction. If you find a bug, have a feature idea, or want to discuss the interaction model, open an issue.

**Pull requests may not be merged.** The OSS version is not the primary development target. We read every PR and appreciate the thought, but the product codebase is separate and may evolve differently.

**Forking is encouraged.** If you want to extend Corvus for your own use, fork away under the terms of the [AGPL-3.0 license](LICENSE).

## Self-Hosting

See the [Quick Start](README.md#quick-start) section in the README. You need Node.js, pnpm, and an Anthropic API key.

```bash
git clone https://github.com/thutch-conecrow/corvus-ledger.git
cd corvus-ledger
pnpm install
cp .env.example .env.local    # Add your API key
pnpm dev
```

You can also skip the `.env.local` and enter your API key directly in the settings modal.

## Bug Reports

When reporting a bug, include:

- What you did (steps to reproduce)
- What you expected
- What happened instead
- Browser and OS
- Console errors, if any

Ledger data is stored in your browser's localStorage. If the issue is data-related, an export (via the export button in the app) may help — but review it for sensitive content before sharing.

## Code Style

If you do submit a PR:

```bash
pnpm check    # Runs typecheck + lint + format check
pnpm lint:fix # Auto-fix lint issues
pnpm format   # Auto-format with Prettier
```

All checks must pass. Zero lint warnings allowed.
