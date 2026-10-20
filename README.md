# Deploy and Host Instatic with Railway

Instatic is an open-source (MIT) visual website builder and CMS: a canvas editor, pages, collections and content entries, media, forms and plugins, published as clean HTML and CSS without a framework runtime. This community template runs Instatic 0.0.21 on Postgres with a persistent volume and an Owner account that exists before the site goes online.

## About Hosting Instatic

Instatic is a single Bun server that serves the editor at `/admin` and the published site at `/` on the same domain. It keeps content, users, sessions and settings in a database (Postgres or SQLite) and writes media, fonts, plugin packages and the published pages to disk. Hosting it well means a durable database, a persistent volume for files, HTTPS with the right CSRF origin, an encryption key for stored secrets, and a first login nobody else can claim. This template pins the official 0.0.21 image, uses Railway Postgres on the private network, keeps files on a volume, runs as the image's unprivileged user and creates your Owner account from Railway variables before the HTTP port opens, so the public setup wizard is closed from the first request.

## Common Use Cases

- Marketing sites, landing pages and portfolios designed visually and published as fast static HTML
- Small business or agency sites where editors manage pages, blog posts and collections without touching code
- Moving off Webflow, Framer or Squarespace to a site and content store you host and own
- Sites with contact or lead forms that store submissions in your own database
- Teams that want roles, version history, branches with preview links and AI or MCP-assisted editing on one self-hosted install

## Dependencies for Instatic Hosting

- Postgres for content, users and settings (included, Railway Postgres 18 on the private network)
- A persistent volume at `/app/storage` for media, fonts, plugin packages, published pages and the runtime package cache (included)
- A generated `INSTATIC_SECRET_KEY` for encrypted AI provider keys, plugin secrets and MFA seeds (included)
- Optional: an API key from Anthropic, OpenAI or OpenRouter (or your own Ollama) for the AI page builder, added later in the admin

### Deployment Dependencies

- Instatic repository: https://github.com/CoreBunch/Instatic
- Release 0.0.21 notes: https://github.com/CoreBunch/Instatic/releases/tag/v0.0.21
- Upstream deployment docs: https://github.com/CoreBunch/Instatic/tree/main/docs/deployment
- Backup and restore guide: https://github.com/CoreBunch/Instatic/blob/main/docs/deployment/backup-restore.md
- Railway volumes: https://docs.railway.com/volumes/reference
- Railway Postgres: https://docs.railway.com/databases/postgresql

### Implementation Details

| Service | Source | Purpose |
|---|---|---|
| Instatic | `ghcr.io/corebunch/instatic:0.0.21` plus a small entrypoint (repo `baranberkay96/instatic-railway`, `services/instatic`) | Editor at `/admin`, API, published site at `/`, on port 8080 (public, healthcheck `/health`); volume `/app/storage` |
| Postgres | `ghcr.io/railwayapp-templates/postgres-ssl:18` | Content database, private network only; volume `/var/lib/postgresql/data` |

**First login**

1. Enter your email as `INSTATIC_ADMIN_EMAIL` when you deploy. It is the only required value and only a sign-in name: Instatic never sends email.
2. On first boot the service waits for Postgres, applies migrations and creates the site, a starter Home page and your Owner account. Only then does the HTTP port open, so nobody can reach the setup wizard before you.
3. Open `https://{your-domain}/admin` and sign in with your email and the generated password in `INSTATIC_ADMIN_PASSWORD` (Instatic service, Variables tab). Change the password under your account, and consider turning on TOTP MFA.
4. Design the Home page and publish it. Until the first publish, `/` answers "not found".

**Editor and site share one domain.** The admin lives under `/admin` and its session cookie is scoped to that path; everything else is the published site. When you add a custom domain, append it to `PUBLIC_ORIGIN` (comma-separated, for example `https://${{RAILWAY_PUBLIC_DOMAIN}},https://www.example.com`) so you can also sign in through it.

**Storage**: media, fonts, plugin packages and published pages live on the `/app/storage` volume (Railway Buckets are not used because Instatic 0.0.21 has no built-in S3 storage; S3 adapters come from plugins). Turn on daily and weekly backups for this volume and for the Postgres volume (Backups tab of each service); a restore needs both.

**SQLite instead of Postgres**: set `DATABASE_URL` to `sqlite:/app/storage/data/cms.db` and delete the Postgres service. One service and a lower bill, but a single writer, backups only through volume snapshots and no path to more than one app instance. Postgres is the default here because it handles several editors writing at once and has its own backup tools.

**Scaling**: Instatic runs as one instance because it writes to a volume. Give the service more RAM or CPU for large sites, many editors or heavy image uploads.

**Pinning and upgrades**: the image tag is the `INSTATIC_VERSION` variable (default `0.0.21`). Instatic is pre-1.0 and any release may contain breaking changes: read the changelog, back up the volume and Postgres, set the new tag and redeploy. Migrations run on boot. The build checks that the new image still provides what the entrypoint needs and fails before deploying if not.

**Accounts**: `INSTATIC_ADMIN_*` are read on the first boot only. Instatic 0.0.21 has no email-based password reset, so store the Owner password in a password manager and create a second administrator under Users as a fallback. Five failed sign-ins lock an account for 15 minutes, doubling up to 24 hours.

### Why Deploy Instatic on Railway?

Railway runs the editor, the published site and the database in one project with HTTPS, private networking, volumes and backups, so you get a self-hosted Webflow-style builder without managing a server. The defaults are locked down from the first deploy, and you keep full ownership of your content and code.
