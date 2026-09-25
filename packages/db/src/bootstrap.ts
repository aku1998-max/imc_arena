import pg from 'pg';

export interface BootstrapOptions {
  adminUrl: string;
  migrationUrl: string;
  runtimeUrl: string;
  reset?: boolean;
  log?: (msg: string) => void;
}

function parse(url: string) {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * LOCAL/CI ONLY. Creates the owner (migration) role, the runtime role and the database using a
 * superuser connection. Hosted environments create these roles through their own provisioning
 * (see docs/runbooks/database-roles.md). The runtime role is never superuser, owner or BYPASSRLS.
 */
export async function bootstrapDatabase(opts: BootstrapOptions): Promise<void> {
  const log = opts.log ?? console.log;
  const owner = parse(opts.migrationUrl);
  const runtime = parse(opts.runtimeUrl);
  if (owner.database !== runtime.database) {
    throw new Error('Migration and runtime URLs must point to the same database');
  }
  if (owner.user === runtime.user) {
    throw new Error('The migration identity must differ from the runtime identity');
  }
  if (runtime.user !== 'imc_api') {
    throw new Error('Migrations grant privileges to the runtime role "imc_api"; use that name');
  }
  for (const id of [owner.user, runtime.user, owner.database]) {
    if (!IDENT.test(id)) throw new Error(`Unsafe identifier: ${id}`);
  }
  const admin = new pg.Client({ connectionString: opts.adminUrl });
  await admin.connect();
  try {
    if (opts.reset) {
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
        [owner.database],
      );
      await admin.query(`drop database if exists ${owner.database}`);
      log(`dropped database ${owner.database}`);
    }
    const ensureRole = async (name: string, password: string, attrs: string) => {
      const exists = await admin.query('select 1 from pg_roles where rolname = $1', [name]);
      const verb = exists.rowCount ? 'alter' : 'create';
      // Password literal is escaped with format(%L) server-side.
      const { rows } = await admin.query<{ sql: string }>(
        `select format('${verb} role %I with ${attrs} password %L', $1::text, $2::text) as sql`,
        [name, password],
      );
      await admin.query(rows[0]!.sql);
      log(`${verb}d role ${name}`);
    };
    await ensureRole(
      owner.user,
      owner.password,
      'login nosuperuser bypassrls nocreatedb nocreaterole',
    );
    await ensureRole(
      runtime.user,
      runtime.password,
      'login nosuperuser nobypassrls nocreatedb nocreaterole',
    );
    const db = await admin.query('select 1 from pg_database where datname = $1', [owner.database]);
    if (!db.rowCount) {
      await admin.query(`create database ${owner.database} owner ${owner.user}`);
      log(`created database ${owner.database}`);
    }
    await admin.query(`revoke all on database ${owner.database} from public`);
    await admin.query(`grant connect on database ${owner.database} to ${runtime.user}`);
  } finally {
    await admin.end();
  }
  // Lock down the public schema inside the new database.
  const ownerClient = new pg.Client({
    connectionString: opts.adminUrl.replace(/\/[^/?]*(\?|$)/, `/${owner.database}$1`),
  });
  await ownerClient.connect();
  try {
    await ownerClient.query('revoke create on schema public from public');
  } finally {
    await ownerClient.end();
  }
}
