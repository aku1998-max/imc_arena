import { loadDotEnv } from '@imc/db';
import { asOwner, resetTestDatabase, testDatabaseUrls } from '@imc/testing';
import { STAFF } from './staff';

export default async function globalSetup() {
  loadDotEnv();
  const urls = testDatabaseUrls(process.env, 'imc_arena_e2e');
  await resetTestDatabase(urls);
  await asOwner(urls.migrationUrl, async (c) => {
    for (const [role, id] of Object.entries(STAFF)) {
      await c.query(`insert into app.accounts (id) values ($1) on conflict do nothing`, [id]);
      await c.query(
        `insert into app.staff_roles (account_id, role) values ($1, $2) on conflict do nothing`,
        [id, role],
      );
    }
    for (const slug of ['arithmetic', 'geometry']) {
      await c.query(`insert into app.topics (slug, display_key) values ($1, $2)`, [
        slug,
        `topic.${slug}`,
      ]);
    }
  });
}
