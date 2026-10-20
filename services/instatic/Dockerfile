# syntax=docker/dockerfile:1
#
# Instatic for Railway (community template, not affiliated with CoreBunch).
#
# The official image, unchanged, plus two small files:
#   railway-entrypoint.sh  hands the Railway volume (mounted as root) to the
#                          image's `bun` user and drops root before anything runs;
#   railway-bootstrap.ts   waits for Postgres, runs migrations and creates the
#                          Owner account from service variables before the HTTP
#                          server binds, so the setup wizard is never public.
#
# Upgrade: set the INSTATIC_VERSION service variable (Railway passes it in as a
# build argument) to a newer tag of ghcr.io/corebunch/instatic and redeploy.
# Instatic is pre-1.0 and any release may break things: read
# https://github.com/CoreBunch/Instatic/blob/main/CHANGELOG.md first and back up
# the volume and Postgres. Migrations run automatically on boot.
ARG INSTATIC_VERSION=0.0.21
FROM ghcr.io/corebunch/instatic:${INSTATIC_VERSION}

USER root

COPY --chmod=0755 railway-entrypoint.sh /usr/local/bin/railway-entrypoint.sh
COPY --chown=bun:bun railway-bootstrap.ts /app/railway/railway-bootstrap.ts

# Fail the build, not the deploy, when an image tag no longer provides what the
# entrypoint and the bootstrap rely on.
RUN set -eu; \
    command -v setpriv; \
    command -v find; \
    id bun; \
    test -d /home/bun; \
    test -f /app/server/index.ts; \
    test -f /app/server/handlers/cms/setup.ts; \
    sh -n /usr/local/bin/railway-entrypoint.sh; \
    bun /app/railway/railway-bootstrap.ts --check

ENV PORT=8080 \
    UPLOADS_DIR=/app/storage/uploads \
    RUNTIME_CACHE_DIR=/app/storage/runtime-cache

EXPOSE 8080

# Starts as root only to fix volume ownership; Instatic itself runs as `bun`.
ENTRYPOINT ["/usr/local/bin/railway-entrypoint.sh"]
CMD ["bun", "run", "server/index.ts"]
