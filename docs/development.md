# Local development and deployment

The project uses pnpm 11, pinned in `package.json`, with the committed `pnpm-lock.yaml`.

## Develop locally

```sh
pnpm install
pnpm run dev
```

Useful checks and build commands:

```sh
pnpm run test
pnpm run test:browser
pnpm run build
pnpm run api:lint
pnpm run api:build
pnpm run wrangler:dry-run
```

`api:lint` validates the OpenAPI 3.1 contract. `api:build` bundles it into `dist/client/api/openapi.yaml` and generates a self-hosted Swagger UI at `dist/client/api/index.html`. After deployment, the API reference is available at `/api/` and the compiled contract at `/api/openapi.yaml`.

## Deploy from a local checkout

Authenticate with GitHub and run:

```sh
gh auth login
pnpm run deploy:release
```

The helper installs from the frozen lockfile, builds the application and API docs, runs Wrangler's dry run, and deploys the current checkout. It prompts for `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` if they are missing; the token is hidden while typing.

## Deploy through GitHub Actions

The checkout must be clean and on `main`. Configure repository secrets named `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, then run:

```sh
pnpm run deploy:github
```

This dispatches `.github/workflows/deploy.yml` on `main` and waits for its result. To have the helper configure missing secrets interactively, run:

```sh
pnpm run deploy:release -- --github --configure-github
```

For non-interactive runs, provide both Cloudflare credentials as environment variables before invoking the helper.
