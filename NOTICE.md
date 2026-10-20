# NOTICE

This Railway template is a community package. It is not affiliated with, sponsored by or endorsed by CoreBunch, the Instatic project or its authors.

## What this template runs

| Component | Source | License |
|---|---|---|
| Instatic 0.0.21 | `ghcr.io/corebunch/instatic:0.0.21` (index digest `sha256:6aa56b7d048f894c7821d1e7debd94a54e09bcc45332ad04d51e30e20545bca0`, linux/amd64, built 2026-10-12 from https://github.com/CoreBunch/Instatic tag `v0.0.21`, commit `d1abbefacb2e716dcab4c29ca972e2eb32dfab42`), used unmodified as the base image | MIT, Copyright (c) 2026 David Babinec |
| Inside that image | Bun 1.4.2 on Debian trixie (`oven/bun`), Instatic's npm dependencies (e.g. sharp, jsdom, esbuild) | Their own licenses, as shipped by upstream |
| Postgres | `ghcr.io/railwayapp-templates/postgres-ssl:18` (service definition copied from Railway's own Postgres template) | PostgreSQL License; Railway image MIT |

Instatic's MIT license requires the copyright notice and permission notice to accompany copies or substantial portions of the software. This package does not copy Instatic source files; the notice is reproduced here because the template distributes a build based on the Instatic image:

> MIT License
>
> Copyright (c) 2026 David Babinec
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The name "Instatic" and the upstream favicon (used as the template icon, loaded from the `v0.0.21` tag through jsDelivr) are used only to identify the software this template deploys.

## What this package adds (original work)

- `services/instatic/Dockerfile`: `FROM` the upstream image, adds the two files below, build-time checks, `ENTRYPOINT`.
- `services/instatic/railway-entrypoint.sh`: prepares the Railway volume, drops root with `setpriv`, runs the bootstrap, then execs the unchanged upstream command `bun run server/index.ts`.
- `services/instatic/railway-bootstrap.ts`: imports Instatic's own modules from the image at runtime (database client, migrations, system roles, setup status, the first-run setup handler, user and audit repositories) and calls them; no upstream code is copied into it.
- `template.json`, `TEMPLATE.md`, `README.md`, this file.

## Upstream material checked (Instatic v0.0.21, 2026-10-20)

Read from `_upstream/corebunch__instatic` (MIT). That copy is newer than v0.0.21, so every file relied on was compared with tag `v0.0.21` through the GitHub contents API (blob SHA):

- Identical to v0.0.21: `Dockerfile`, `package.json`, `CHANGELOG.md`, `docs/deployment/railway.md`, `docs/deployment/README.md`, `server/index.ts`, `server/config.ts`, `server/router.ts`, `server/healthcheck.ts`, `server/db/index.ts`, `server/db/postgres.ts`, `server/db/sqlite.ts`, `server/db/runMigrations.ts`, `server/repositories/users.ts`, `server/repositories/roles.ts`, `server/repositories/audit.ts`, `server/auth/tokens.ts`, `server/auth/security.ts`, `server/secrets/masterKey.ts`, `server/richtextSanitizer.ts`, `server/handlers/cms/index.ts`, `server/publish/publicRoutes.ts`, `server/publish/runtime/dependencyCache.ts`, `server/publish/runtime/packageServer.ts`, `server/forms/challenge.ts`, `server/handlers/cms/imageVariantWorkerHost.ts`, `src/core/utils/email.ts`, `src/core/utils/passwordPolicy.ts`.
- Different after v0.0.21: `server/handlers/cms/setup.ts` and `server/repositories/setup.ts` (post-release change to the seeded site settings). The v0.0.21 versions were fetched and read; the bootstrap calls the handler from the image instead of re-implementing it, so it follows whichever version the image contains.
- Also read: `compose.prod.yml`, `compose.sqlite.yml`, `.env.production.example`, `docs/deployment/backup-restore.md`, `docs/deployment/render.md`, `docs/features/media.md`, `docs/features/auth-and-access.md`, `src/core/plugin-sdk/types/media.ts`.
- Registry: GHCR tag list and image config of `ghcr.io/corebunch/instatic:0.0.21` (user `bun` uid 1000 with home `/home/bun`, entrypoint `docker-entrypoint.sh`, `PORT=3001`, `UPLOADS_DIR=/app/uploads`); the Debian base layer contains `/usr/bin/setpriv` and `find`.

## Market templates

The Railway marketplace templates in `_market/` ("Instatic CMS - SQLite", "Instatic CMS - Postgres", "Instatic") were read for their service layout and variables, which follow upstream's `docs/deployment/railway.md`. No README or description text from them is reused.
