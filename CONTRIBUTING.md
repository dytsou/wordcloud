# Contributing

Thanks for helping improve wordcloud.download. This guide covers the local setup, change expectations, and checks to run before opening a pull request.

## Before you start

- Small fixes, typos, and documentation updates can go straight into a pull request with a clear description.
- For larger behavior changes, open an issue first so the intended behavior can be discussed before implementation.

## Development setup

1. Install Node.js and pnpm 11.
2. Install dependencies and start the local editor:

   ```sh
   pnpm install
   pnpm run dev
   ```

3. Open the local URL printed by Vite.

See [README.md](README.md) for how to use the editor. See [docs/development.md](docs/development.md) for build and deployment details.

## Making changes

- Keep each pull request focused on one logical change.
- Follow the existing TypeScript, React, and CSS patterns; use the repository's formatter and linter.
- Keep user-visible translations in sync across the supported interface locales.
- If an MCP tool's inputs, outputs, or behavior change, update [`openapi.yaml`](openapi.yaml) and the relevant MCP documentation.
- Preserve the editor's local handling of source text. Use synthetic text in examples, screenshots, and fixtures; never include private source text, credentials, or tokens.

## Verify your changes

Run the checks that match your change and list the ones you ran in the pull request:

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:browser
pnpm run build:all
```

For an MCP or OpenAPI change, also run `pnpm run api:lint`. If a relevant check cannot be run, say so and include the reason.

## Pull requests

1. Give the pull request a clear title and explain what changed and why.
2. Link a related issue when one exists (for example, `Fixes #123`).
3. Describe any user-visible behavior changes. Include screenshots for visual changes when they help explain the result.
4. List the checks you ran and any checks you could not run.

Be respectful and keep discussion focused on the project and the proposed change. Review feedback is part of the process; follow-up adjustments are normal.
