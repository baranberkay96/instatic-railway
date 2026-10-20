# Instatic Visual Website Builder and CMS: Railway template spec

## Listing

| Field | Value |
|---|---|
| Name | **Instatic Visual Website Builder and CMS** (given name, unchanged; no version label, see below) |
| Description | Open-source Webflow alternative: visual editor, CMS and clean HTML output. (74 chars, unchanged) |
| Category | CMS |
| Tags | instatic, cms, website-builder, webflow-alternative, visual-editor, static-site, headless-cms, postgres, bun |
| Icon | `https://cdn.jsdelivr.net/gh/CoreBunch/Instatic@v0.0.21/public/favicon.svg` (200, image/svg+xml) |

**Why no version in the name.** The naming rule asks for major.minor on 0.x software, which for Instatic is "v0.0". Every Instatic release so far (0.0.1 to 0.0.21, June to October 2026) is 0.0.x, so "v0.0" tells a buyer nothing, would not change on any upgrade, and reads like a placeholder. Under semver a 0.0.z release may break anything, so the only honest concrete label would be the full "0.0.21", which goes stale with upstream's roughly weekly releases (several of them security fixes we will want to ship quickly) and would force a listing rename each time. The exact pinned version is therefore stated in the README's first paragraph and in this spec instead. Revisit when upstream ships 0.1 ("Instatic v0.1 Visual Website Builder and CMS").

The description is delivered as written: the visual canvas editor, the CMS (pages, posts, collections, data tables, media) and the HTML/CSS publisher are all part of the single Instatic server.

## Base market template

- **Base: "Instatic CMS - Postgres"** (127 active). Same layout as upstream's `docs/deployment/railway.md`: the official image, Railway Postgres via `${{Postgres.DATABASE_URL}}`, an app volume at `/app/storage`, `PORT=8080`, healthcheck `/health`, `PUBLIC_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}`, generated `INSTATIC_SECRET_KEY` and daily/weekly volume backups. Kept all of that.
- "Instatic CMS - SQLite" (1,144 active, 850 deploys in 30 days) is the market leader; identical apart from `DATABASE_URL=sqlite:/app/storage/data/cms.db` and no Postgres. Postgres was chosen as the default here (see trade-off below); switching back to SQLite is one variable.
- "Instatic" (21 active): untagged image, no healthcheck, no volume backups, secret key without the `=` padding (still decodes to 32 bytes). Nothing taken.
- All three: `:latest` / untagged image, `RAILWAY_RUN_UID=0` (the whole app runs as root), and an **open first-run wizard**: whoever opens the URL first creates the Owner account.

**SQLite vs Postgres.** SQLite is one service, cheaper (about $1 to $2 less per month idle) and fine for one person editing a small site; the database file lives on the app volume and is backed up with it. Postgres handles several editors writing at once without single-writer contention, has Railway's database backups/PITR and the Data panel, and keeps the content database separate from the file volume. It cannot yet buy horizontal scaling here (the app writes media to a volume, so it runs one replica). To use SQLite: set `DATABASE_URL=sqlite:/app/storage/data/cms.db`, delete the Postgres service; the entrypoint creates and owns `/app/storage/data`.

**Bucket vs volume.** Instatic 0.0.21 stores media through a storage-adapter registry whose only built-in adapter is local disk; S3/R2 adapters come from third-party plugins, and fonts, plugin packages and published pages always stay on local disk. A Railway Bucket would not be used by the app, so the template uses a volume only.

## Pinned versions

| Service | Image / source | Tag | Release date | Checked |
|---|---|---|---|---|
| Instatic | repo `baranberkay96/instatic-railway`, `/services/instatic` → `FROM ghcr.io/corebunch/instatic:${INSTATIC_VERSION}` | `0.0.21` (= `latest` and `0.0` today; index digest `sha256:6aa56b7d…bca0`, amd64 only) | 2026-10-12 | 2026-10-20 |
| ↳ runtime in that image | `oven/bun` 1.4.2 on Debian trixie | as built by upstream | 2026-09-05 | 2026-10-20 |
| Postgres | `ghcr.io/railwayapp-templates/postgres-ssl` | `18` (Railway base; major tag kept for Railway PITR/HA) | Railway base | 2026-10-20 |

## Architecture

```
          Internet (HTTPS, Railway edge)
                     │  one domain: /admin = editor + API, everything else = published site
                     ▼
     ┌───────────────────────────────────┐  healthcheck GET /health
     │ Instatic :8080 (Bun, user bun)    │  volume /app/storage
     │  editor SPA, CMS API, publisher,  │   ├─ uploads/  media, fonts, plugins,
     │  public site, forms, MCP endpoint │   │            published/current pages
     └────────────────┬──────────────────┘   └─ runtime-cache/  npm packages for pages
                      │ postgresql:// private network
                      ▼
          ┌───────────────────────┐
          │ Postgres 18 (private) │  volume /var/lib/postgresql/data
          └───────────────────────┘
```

Boot sequence of the Instatic container (`railway-entrypoint.sh`, then `railway-bootstrap.ts`):

1. As root: `mkdir` `UPLOADS_DIR`, `RUNTIME_CACHE_DIR` (and the SQLite directory when SQLite is used), `chown` every file on the volume that is not yet owned by `bun` (later boots only walk the tree), warn loudly if no volume is attached or a data path is off the volume.
2. `exec setpriv --reuid=bun --regid=bun --init-groups env HOME=/home/bun` back into the script. Everything after this runs unprivileged, like upstream's own image.
3. Bootstrap (`bun run /app/railway/railway-bootstrap.ts`): checks `INSTATIC_SECRET_KEY` (warning only), waits for Postgres up to `INSTATIC_DB_WAIT_SECONDS` (new client per attempt, 15 s per attempt, 3 s apart, password redacted in logs), runs Instatic's `runMigrations` and `syncSystemRoles`, reads `getSetupStatus`:
   - setup complete → nothing to do (`INSTATIC_ADMIN_*` are ignored after the first boot);
   - fresh install → calls Instatic's own `handleSetupRoutes` in-process with a `POST /admin/api/cms/setup` request (site name, email, password); expects HTTP 201 (site, Owner, starter Home page, audit event in one transaction);
   - site exists but no active Owner → creates only the Owner (+ audit event), so site settings and pages are not overwritten;
   - re-checks that setup is complete; any error exits 1.
4. `exec bun run server/index.ts` (upstream's unchanged command; it runs migrations again as a no-op and binds the port). Because the port opens only after step 3, the setup endpoint answers 409 to the very first internet request; the market templates' wizard is open until someone uses it.

## Services

### Instatic
- Source: repo `baranberkay96/instatic-railway`, root directory `/services/instatic` (Dockerfile). Build arg `INSTATIC_VERSION` (from the service variable) selects the upstream tag. The build fails early if the image lacks `setpriv`, `find`, the `bun` user/home, `server/index.ts` or `server/handlers/cms/setup.ts`, if the entrypoint has a syntax error, or if `railway-bootstrap.ts --check` cannot load the Instatic modules it uses.
- Start command: none (image `ENTRYPOINT railway-entrypoint.sh`, `CMD bun run server/index.ts`). Pre-deploy: none (migrations run in the bootstrap, as upstream intends: "Do not add a separate migration command").
- Healthcheck: `/health`, timeout 600 s (covers the Postgres wait of up to 300 s plus migrations).
- Public domain: yes, target port 8080. TCP proxy: none.
- Volume: `/app/storage` (template requests DAILY and WEEKLY backups, as the market templates do).
- Restart: ON_FAILURE, 10 retries. Replicas: 1 (has a volume).
- Listens on `0.0.0.0` (upstream default `HOST`). Nothing in the project calls it over the private network, and the market templates prove IPv4 works for Railway's edge and healthcheck.

| Variable | Value | Description |
|---|---|---|
| INSTATIC_ADMIN_EMAIL | *(required input)* | Owner sign-in email, used on the first boot. Instatic never sends mail. |
| INSTATIC_ADMIN_PASSWORD | `${{secret(24, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")}}` | Owner password (min. 12 chars upstream), first boot only. |
| INSTATIC_SITE_NAME | `My Instatic Site` | Site name for the first boot. |
| PORT | `8080` | Listen port; public domain and healthcheck target. |
| DATABASE_URL | `${{Postgres.DATABASE_URL}}` | Private Postgres URL; `sqlite:/app/storage/data/cms.db` switches to SQLite. |
| UPLOADS_DIR | `/app/storage/uploads` | Media, fonts, plugin packages, published pages. |
| RUNTIME_CACHE_DIR | `/app/storage/runtime-cache` | npm packages installed at publish time (see improvements). |
| STATIC_DIR | `/app/dist` | Admin SPA inside the image. |
| PUBLIC_ORIGIN | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | CSRF/MCP OAuth origin(s); append custom domains comma-separated. |
| INSTATIC_SECRET_KEY | `${{secret(43, "<base64 alphabet A-Z a-z 0-9 + />")}}=` (exact string in template.json) | Base64 32-byte AES key (upstream's documented Railway expression). |
| TRUSTED_PROXY_CIDRS | *(empty)* | Optional client-IP attribution for audit logs/rate limits. |
| INSTATIC_DB_WAIT_SECONDS | `300` | Postgres wait budget at boot (0–3600). |
| INSTATIC_VERSION | `0.0.21` | Upstream image tag (build argument). |
| RAILWAY_DEPLOYMENT_DRAINING_SECONDS | `30` | Lets the server flush live co-editing documents on SIGTERM. |

Image defaults not exposed: `NODE_ENV=production`, `HOST=0.0.0.0`, `NPM_REGISTRY_URL` (public npm), `IMAGE_VARIANT_WORKER_POOL_SIZE=2`. `RAILWAY_RUN_UID` is not needed: the Dockerfile starts as root and drops to `bun` itself.

### Postgres
Copied from `_railway-base/postgres.json`: image `ghcr.io/railwayapp-templates/postgres-ssl:18`, volume `/var/lib/postgresql/data`, `PGDATA`, `PG*`, `POSTGRES_*`, `DATABASE_URL` (private), `SSL_CERT_DAYS`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60`. No public domain, no TCP proxy (the market Postgres template exposes 5432 publicly; add a TCP proxy yourself if you need external access). Restart ON_FAILURE, 10.

## Improvements over market templates

1. **Setup wizard closed before the first request.** The Owner account is created from service variables by Instatic's own setup handler before the HTTP port opens; the server refuses to start if that fails or the email/password are invalid. All three market templates leave `POST /admin/api/cms/setup` open to whoever arrives first.
2. **No root at runtime.** Market templates set `RAILWAY_RUN_UID=0`, so Instatic (which runs plugins, `bun install` of site dependencies and esbuild at publish time) runs as root. Here only the ownership fix runs as root; the app runs as the image's `bun` user with `HOME=/home/bun` (needed by the publish-time `bun install`).
3. **Pinned image** `0.0.21` instead of `:latest`, with a one-variable upgrade path and a build that fails fast if a new tag breaks the entrypoint's assumptions.
4. **Published pages keep their npm packages across redeploys.** Upstream keeps the runtime dependency cache in the OS temp dir and serves `/_instatic/runtime/cache/...` only from it; it is filled at publish time only. In a container that cache vanishes on every redeploy, so published pages that import npm packages would 404 on those files until the next publish (read from `dependencyCache.ts`/`packageServer.ts`; not reproduced live). `RUNTIME_CACHE_DIR` now points at the volume.
5. **Survives Postgres starting late** (bounded wait loop with clear logs) instead of crashing on the first connection error and burning restart retries.
6. **Guard rails**: refuses to start without `DATABASE_URL` (upstream would silently fall back to an ephemeral SQLite file and lose content on redeploy), warns when no volume is attached or uploads/SQLite are off the volume, warns at boot when `INSTATIC_SECRET_KEY` is unusable instead of failing later with HTTP 500 on MFA or AI keys.
7. **Database stays private** (no public TCP proxy, unlike "Instatic CMS - Postgres").
8. **Clean shutdown**: 30 s draining so the collab relay flushes unsaved co-editing state on redeploy.
9. Every variable documented, including the custom-domain step for `PUBLIC_ORIGIN`.

## Resource estimate

Not measured (no Docker run); estimates from the stack (Bun server with jsdom, sharp, esbuild loaded on demand; upstream's Render template uses a 512 MB plan).

| Service | Idle RAM | Typical RAM | Typical vCPU | Volume |
|---|---|---|---|---|
| Instatic | ~0.2 GB | 0.4–0.5 GB (spikes during image uploads and publishes) | 0.1 | 0.5–5 GB |
| Postgres | ~0.08 GB | 0.15–0.25 GB | 0.03 | 0.3–1 GB |
| **Total** | **~0.3 GB, ~0.02 vCPU** | **~0.65 GB, ~0.13 vCPU** | | **~1–6 GB** |

At Railway prices (RAM $10/GB-month, vCPU $20/vCPU-month, volume $0.15/GB-month):
- Idle / just deployed: 0.3 × 10 + 0.02 × 20 + 1 × 0.15 ≈ **$3.5 / month**.
- Typical small business site with a few editors: 0.65 × 10 + 0.13 × 20 + 4 × 0.15 ≈ **$10 / month**, plus egress for site traffic.
- SQLite variant: about $1–2 less.

Minimum plan: **Trial** boots it (each service under 1 GB RAM; small volumes) for evaluation. **Hobby** is recommended for a real site (5 GB volume per service). Pro when media exceeds 5 GB.

## Verification checklist

1. Deploy with `INSTATIC_ADMIN_EMAIL`. The Instatic build log shows the RUN check passing (`[railway-bootstrap] module check passed`).
2. Instatic deploy logs, in order: `[railway-entrypoint] running as bun`, `Postgres at postgres.railway.internal is reachable`, `migrations and system roles are up to date`, `created the site "My Instatic Site", its Home page and the Owner account …`, `starting Instatic`, `[server] Listening on http://localhost:8080`. No `EACCES`.
3. `GET https://{domain}/health` → 200 `{"status":"ok"}`. `GET /admin/api/cms/setup/status` → `needsSetup: false`. `curl -X POST -H 'content-type: application/json' -d '{}' https://{domain}/admin/api/cms/setup` → 409 `Setup already complete` (requests without an Origin header pass the CSRF check, so this is exactly what an attacker would try).
4. Open `/admin`: the login screen appears (not the setup wizard). Sign in with the email and `INSTATIC_ADMIN_PASSWORD`; change the password; enable TOTP MFA (proves `INSTATIC_SECRET_KEY` works).
5. Upload an image in Media (variants generated), edit Home, publish; `GET /` → 200 HTML. Add a page that imports an npm package (Dependencies panel), publish, check the `/_instatic/runtime/cache/...` URL loads.
6. Redeploy Instatic: logs show `an active Owner exists; first-run setup stays closed`; media, published pages and the runtime-cache URL still load; session still valid.
7. Restart Postgres while Instatic runs, and redeploy both at once: Instatic waits and comes up without manual steps.
8. `railway ssh` into Instatic: `ps -o user,cmd` shows `bun` for the server; `ls -ln /app/storage` shows uid 1000.
9. Postgres has no public networking.

## Open questions

- Nothing was built or run: the Dockerfile build (`COPY --chmod`, the RUN checks, `bun … --check` loading Instatic's modules), Bun resolving the bootstrap's relative/extensionless imports and the tsconfig aliases inside upstream files from `/app/railway`, and Bun SQL's behaviour while Postgres is unreachable all need the Railway deploy test. The bootstrap logic itself was exercised against stubbed modules and the entrypoint against fake binaries (see report).
- Whether Railway passes the `INSTATIC_VERSION` service variable into the global `ARG` before `FROM` as documented for Dockerfile builds; if not, the Dockerfile default `0.0.21` is used, which is still correct.
- `backupSchedules` on the Instatic volume is in `template.json`, but `_tools/to_serialized.py` only copies `mountPath`; the publish tooling has to pass it through, or backups must be enabled by hand.
- The runtime-cache fix is based on reading upstream code; confirm by publishing a page with an npm import and redeploying (checklist 5–6).
- Railway's edge IP range is not documented, so `TRUSTED_PROXY_CIDRS` stays empty (upstream's advice). Until set, Instatic's per-IP login limit sees every visitor as the proxy address and audit logs record the proxy IP; the per-account lockout still applies.
- Instatic has no email password reset; losing the Owner password needs a second admin account or a database edit.
- Idle and typical RAM figures are estimates, not measurements.
