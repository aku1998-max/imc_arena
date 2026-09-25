import { content, ops, withTx, type Pool } from '@imc/db';
import { contentService, jobs, type Deps } from '@imc/domain';
import { SEED_TOPICS, syntheticQuestions } from '@imc/testing';
import pg from 'pg';

/** Fixed development identities. They exist only in local/test databases. */
export const DEV_STAFF = {
  editor: '00000000-0000-4000-8000-00000000e001',
  reviewer: '00000000-0000-4000-8000-00000000e002',
  administrator: '00000000-0000-4000-8000-00000000e003',
} as const;
export const DEV_PARENT = '00000000-0000-4000-8000-00000000a001';

/**
 * Staff roles are server-controlled records: they are written with the owner/migration identity
 * (or by an administrator through the audited API), never self-assigned.
 */
export async function seedStaff(migrationUrl: string, staff: Record<string, string> = DEV_STAFF) {
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    for (const [role, id] of Object.entries(staff)) {
      await client.query(`insert into app.accounts (id) values ($1) on conflict do nothing`, [id]);
      await client.query(
        `insert into app.staff_roles (account_id, role, active) values ($1, $2, true)
         on conflict (account_id, role) do update set active = true`,
        [id, role],
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Seeds topics and original synthetic questions through the real editorial workflow:
 * import -> draft -> submit -> independent review -> publish.
 */
export async function seedContent(
  deps: Deps,
  opts: { perTopicPerGrade?: number; staff?: typeof DEV_STAFF } = {},
) {
  const staff = opts.staff ?? DEV_STAFF;
  const pool: Pool = deps.pool;
  const as = (accountId: string) => ({ type: 'staff' as const, accountId });

  await withTx(pool, as(staff.administrator), async (tx) => {
    for (const t of SEED_TOPICS) await contentService.createTopic(tx, t);
  });
  const questions = syntheticQuestions(opts.perTopicPerGrade ?? 9);
  const importId = await withTx(pool, as(staff.editor), (tx) =>
    contentService.createImport(tx, {
      schemaVersion: 1,
      sourceType: 'original',
      rightsStatus: 'cleared',
      rightsNotes: 'Original synthetic questions written for IMC Arena development.',
      questions,
    }),
  );
  // Run the import job now rather than waiting for the worker.
  while ((await jobs.runJobsOnce(deps, { limit: 20 })).claimed > 0) {
    /* drain */
  }
  const drafts = await withTx(pool, as(staff.editor), (tx) =>
    content.listVersions(tx, { state: 'draft', limit: 5000 }),
  );
  for (const v of drafts) {
    await withTx(pool, as(staff.editor), (tx) => contentService.submitForReview(tx, v.id));
    await withTx(pool, as(staff.reviewer), (tx) =>
      contentService.reviewVersion(tx, v.id, { decision: 'approve' }),
    );
    await withTx(pool, as(staff.administrator), (tx) => contentService.publishVersion(tx, v.id));
  }
  const imported = await withTx(pool, as(staff.editor), (tx) =>
    contentService.getImport(tx, importId),
  );
  const published = await withTx(pool, { type: 'system', reason: 'seed' }, (tx) =>
    ops.publishedInventoryByGrade(tx),
  );
  return { imported, published };
}
