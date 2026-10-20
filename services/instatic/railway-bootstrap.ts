/**
 * Railway bootstrap for Instatic (community template, not affiliated with CoreBunch).
 *
 * Copied into the image as /app/railway/railway-bootstrap.ts and run by
 * railway-entrypoint.sh as the unprivileged `bun` user, BEFORE the Instatic
 * HTTP server binds its port:
 *
 *   1. Wait until the database in DATABASE_URL answers (Postgres may still be
 *      starting when this service boots).
 *   2. Apply Instatic's migrations and system roles, exactly as
 *      server/index.ts does on every boot (both steps are idempotent).
 *   3. If the install has no active Owner yet, create the site and the Owner
 *      from INSTATIC_ADMIN_EMAIL / INSTATIC_ADMIN_PASSWORD by calling
 *      Instatic's own first-run setup handler in-process.
 *
 * Step 3 finishes before the server listens, so the public setup wizard
 * (POST /admin/api/cms/setup) already answers 409 to the first request from
 * the internet. Every failure exits non-zero: the server never starts with an
 * unclaimed install.
 *
 * `--check` only loads the Instatic modules used here and exits. The
 * Dockerfile runs it, so an image tag that no longer matches fails the build
 * instead of the deploy.
 */

const PREFIX = '[railway-bootstrap]'
const SETUP_ENDPOINT = 'http://127.0.0.1/admin/api/cms/setup'
const BOOTSTRAP_USER_AGENT = 'railway-bootstrap'
const DEFAULT_SITE_NAME = 'My Instatic Site'
const DEFAULT_DB_WAIT_SECONDS = 300
const MAX_DB_WAIT_SECONDS = 3_600
const RETRY_DELAY_MS = 3_000
const ATTEMPT_TIMEOUT_MS = 15_000
const LOG_EVERY_N_ATTEMPTS = 10

interface Db {
  <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number }>
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
  readonly dialect: 'postgres' | 'sqlite'
}

interface DbHandle {
  db: Db
  migrations: unknown[]
}

interface SetupStatus {
  hasSite: boolean
  hasOwner: boolean
  needsSetup: boolean
}

interface OwnerInput {
  email: string
  password: string
  siteName: string
}

function log(message: string): void {
  console.log(`${PREFIX} ${message}`)
}

function warn(message: string): void {
  console.warn(`${PREFIX} WARNING: ${message}`)
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? `${err.name} ${code}: ${err.message}` : `${err.name}: ${err.message}`
  }
  return String(err)
}

/** `new URL()` without the throw: SQLite paths and empty values are not URLs. */
function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Strip the admin password and the database password from anything we print. */
function redact(text: string): string {
  const secrets: string[] = []
  const adminPassword = process.env.INSTATIC_ADMIN_PASSWORD ?? ''
  if (adminPassword) secrets.push(adminPassword)
  const password = parseUrl(process.env.DATABASE_URL ?? '')?.password ?? ''
  if (password) secrets.push(password, safeDecode(password))
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((out, secret) => out.split(secret).join('***'), text)
}

/**
 * Load the Instatic modules this script uses, in the same order as
 * server/index.ts (the server-side richtext sanitizer is installed first).
 * Relative paths resolve inside the image: this file lives in /app/railway.
 */
async function loadInstatic() {
  await import('../server/richtextSanitizer')
  const dbIndex = await import('../server/db')
  const migrationRunner = await import('../server/db/runMigrations')
  const roles = await import('../server/repositories/roles')
  const setupRepository = await import('../server/repositories/setup')
  const setupRoutes = await import('../server/handlers/cms/setup')
  const users = await import('../server/repositories/users')
  const audit = await import('../server/repositories/audit')
  const tokens = await import('../server/auth/tokens')
  const masterKey = await import('../server/secrets/masterKey')
  const email = await import('../src/core/utils/email')
  const passwordPolicy = await import('../src/core/utils/passwordPolicy')

  const api = {
    createDbClient: dbIndex.createDbClient as (url: string) => DbHandle,
    isSqliteUrl: dbIndex.isSqliteUrl as (url: string) => boolean,
    runMigrations: migrationRunner.runMigrations as (db: Db, migrations: unknown[]) => Promise<void>,
    syncSystemRoles: roles.syncSystemRoles as (db: Db) => Promise<void>,
    getSetupStatus: setupRepository.getSetupStatus as (db: Db) => Promise<SetupStatus>,
    handleSetupRoutes: setupRoutes.handleSetupRoutes as (req: Request, db: Db) => Promise<Response | null>,
    createUser: users.createUser as (db: Db, input: Record<string, unknown>) => Promise<{ id: string }>,
    createAuditEvent: audit.createAuditEvent as (db: Db, input: Record<string, unknown>) => Promise<void>,
    hashPassword: tokens.hashPassword as (password: string) => Promise<string>,
    loadMasterKey: masterKey.loadMasterKey as () => Promise<unknown>,
    isValidEmail: email.isValidEmail as (value: string) => boolean,
  }
  for (const [name, value] of Object.entries(api)) {
    if (typeof value !== 'function') {
      throw new Error(`Instatic no longer exports ${name}; this bootstrap does not match the image version`)
    }
  }
  const minPasswordLength = passwordPolicy.MIN_PASSWORD_LENGTH
  if (typeof minPasswordLength !== 'number') {
    throw new Error('Instatic no longer exports MIN_PASSWORD_LENGTH; this bootstrap does not match the image version')
  }
  return { ...api, minPasswordLength }
}

type Instatic = Awaited<ReturnType<typeof loadInstatic>>

function readWaitSeconds(): number {
  const raw = (process.env.INSTATIC_DB_WAIT_SECONDS ?? '').trim()
  if (!raw) return DEFAULT_DB_WAIT_SECONDS
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_DB_WAIT_SECONDS) {
    throw new Error(`INSTATIC_DB_WAIT_SECONDS must be a whole number between 0 and ${MAX_DB_WAIT_SECONDS} (got "${raw}")`)
  }
  return parsed
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000}s`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function closeAfterFailedConnect(db: Db): Promise<void> {
  try {
    await db.close()
  } catch (err) {
    // The client never connected; a failing close only means there was nothing to release.
    log(`closing the unconnected client failed (${redact(describe(err))}); continuing`)
  }
}

/** Open the database, retrying Postgres until it answers or the wait budget runs out. */
async function connect(instatic: Instatic, databaseUrl: string): Promise<DbHandle> {
  if (instatic.isSqliteUrl(databaseUrl)) {
    const handle = instatic.createDbClient(databaseUrl)
    await handle.db`select 1 as ok`
    log('using SQLite')
    return handle
  }
  if (!databaseUrl.startsWith('postgres:') && !databaseUrl.startsWith('postgresql:')) {
    throw new Error('DATABASE_URL must start with postgres://, postgresql://, sqlite: or file:')
  }

  const host = parseUrl(databaseUrl)?.hostname || 'unknown host'
  const waitSeconds = readWaitSeconds()
  const deadline = Date.now() + waitSeconds * 1000
  for (let attempt = 1; ; attempt++) {
    const handle = instatic.createDbClient(databaseUrl)
    try {
      await withTimeout(handle.db`select 1 as ok`, ATTEMPT_TIMEOUT_MS)
      log(`Postgres at ${host} is reachable (attempt ${attempt})`)
      return handle
    } catch (err) {
      await closeAfterFailedConnect(handle.db)
      const reason = redact(describe(err))
      if (Date.now() >= deadline) {
        throw new Error(`Postgres at ${host} did not answer within ${waitSeconds}s (${reason})`)
      }
      if (attempt === 1 || attempt % LOG_EVERY_N_ATTEMPTS === 0) {
        log(`waiting for Postgres at ${host} (${reason})`)
      }
      await Bun.sleep(RETRY_DELAY_MS)
    }
  }
}

function readOwnerInput(instatic: Instatic): OwnerInput {
  const email = (process.env.INSTATIC_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.INSTATIC_ADMIN_PASSWORD ?? ''
  const siteName = (process.env.INSTATIC_SITE_NAME ?? '').trim() || DEFAULT_SITE_NAME

  if (!email) {
    throw new Error('INSTATIC_ADMIN_EMAIL is empty. Set it to the email you want to sign in with; Instatic will not start with an open setup wizard')
  }
  if (!instatic.isValidEmail(email)) {
    throw new Error(`INSTATIC_ADMIN_EMAIL "${email}" is not a valid email address`)
  }
  if (password !== password.trim()) {
    throw new Error('INSTATIC_ADMIN_PASSWORD must not start or end with whitespace')
  }
  if (password.length < instatic.minPasswordLength) {
    throw new Error(`INSTATIC_ADMIN_PASSWORD must be at least ${instatic.minPasswordLength} characters`)
  }
  return { email, password, siteName }
}

/** Fresh install: run Instatic's own setup handler (site, Owner, starter Home page, audit event). */
async function runFirstRunSetup(instatic: Instatic, db: Db, owner: OwnerInput): Promise<void> {
  const request = new Request(SETUP_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': BOOTSTRAP_USER_AGENT },
    body: JSON.stringify({ siteName: owner.siteName, email: owner.email, password: owner.password }),
  })
  const response = await instatic.handleSetupRoutes(request, db)
  if (!response) {
    throw new Error('the Instatic setup handler ignored the request; this bootstrap does not match the image version')
  }
  if (response.status !== 201) {
    throw new Error(`the Instatic setup handler answered HTTP ${response.status}: ${redact(await response.text())}`)
  }
}

/**
 * The site row exists but no active Owner does (e.g. the Owner was removed in
 * SQL). Create only the Owner: re-running the setup handler would overwrite
 * the site settings and seed a second Home page.
 */
async function createMissingOwner(instatic: Instatic, db: Db, owner: OwnerInput): Promise<void> {
  const passwordHash = await instatic.hashPassword(owner.password)
  await db.transaction(async (tx) => {
    const user = await instatic.createUser(tx, {
      email: owner.email,
      displayName: '',
      passwordHash,
      roleId: 'owner',
      allowOwnerRole: true,
    })
    await instatic.createAuditEvent(tx, {
      actorUserId: null,
      action: 'user.create',
      targetType: 'user',
      targetId: user.id,
      metadata: { roleId: 'owner', source: BOOTSTRAP_USER_AGENT },
      ipAddress: null,
      userAgent: BOOTSTRAP_USER_AGENT,
    })
  })
}

async function ensureOwner(instatic: Instatic, db: Db): Promise<void> {
  const status = await instatic.getSetupStatus(db)
  if (!status.needsSetup) {
    log('an active Owner exists; first-run setup stays closed (INSTATIC_ADMIN_* are only read on the first boot)')
    return
  }

  const owner = readOwnerInput(instatic)
  if (!status.hasSite) {
    await runFirstRunSetup(instatic, db, owner)
    log(`created the site "${owner.siteName}", its Home page and the Owner account ${owner.email}`)
  } else {
    await createMissingOwner(instatic, db, owner)
    log(`the site had no active Owner; created the Owner account ${owner.email}`)
  }

  const after = await instatic.getSetupStatus(db)
  if (after.needsSetup) {
    throw new Error('setup is still pending after the bootstrap; refusing to start with an open setup wizard')
  }
  log('sign in at /admin with INSTATIC_ADMIN_EMAIL and the password stored in INSTATIC_ADMIN_PASSWORD, then change it')
}

/** A missing or malformed key only breaks AI credentials, plugin secrets and MFA, so warn instead of blocking. */
async function checkSecretKey(instatic: Instatic): Promise<void> {
  try {
    await instatic.loadMasterKey()
  } catch (err) {
    warn(`INSTATIC_SECRET_KEY is unusable (${describe(err)}). AI provider keys, plugin secrets and TOTP MFA will fail until it is a base64 32-byte key`)
  }
}

async function main(): Promise<void> {
  const instatic = await loadInstatic()
  if (process.argv.includes('--check')) {
    log('module check passed')
    return
  }

  const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is empty. Use ${{Postgres.DATABASE_URL}} or sqlite:/app/storage/data/cms.db')
  }

  await checkSecretKey(instatic)
  const { db, migrations } = await connect(instatic, databaseUrl)
  try {
    await instatic.runMigrations(db, migrations)
    await instatic.syncSystemRoles(db)
    log('migrations and system roles are up to date')
    await ensureOwner(instatic, db)
  } finally {
    await db.close().catch((err: unknown) => warn(`closing the database client failed (${redact(describe(err))})`))
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(`${PREFIX} ERROR: ${redact(describe(err))}`)
    process.exit(1)
  },
)
