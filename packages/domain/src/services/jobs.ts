import { accounts, exportData, ops, practice, type JobRow, withTx } from '@imc/db';
import { productDefaults } from '../config.js';
import type { Deps } from '../ports.js';
import { addDays, localDateIn, weekStart } from '../time.js';
import { billingSweep, processBillingEvent } from './billing.js';
import { processImport } from './content.js';

const sys = (reason: string) => ({ type: 'system' as const, reason });

type Handler = (deps: Deps, job: JobRow) => Promise<void>;

/** Every handler is idempotent: a reclaimed lease may run it again after a crash. */
export const jobHandlers: Record<string, Handler> = {
  'progress.refresh': async (deps, job) => {
    const { studentId, localDate } = job.payload as { studentId: string; localDate: string };
    await withTx(deps.pool, sys('progress'), async (tx) => {
      if (await accounts.findStudent(tx, studentId)) {
        await practice.refreshProgressDaily(tx, studentId, localDate);
      }
    });
  },

  'content.import': async (deps, job) => {
    const { importId } = job.payload as { importId: string };
    await withTx(deps.pool, sys('import'), (tx) => processImport(tx, importId));
  },

  'billing.event': async (deps, job) => {
    await processBillingEvent(
      deps.pool,
      deps.billing,
      job.payload as { provider: string; eventId: string; customers: string[] },
    );
  },

  'billing.sweep': async (deps) => {
    if (!deps.billing.enabled) return;
    await billingSweep(deps.pool, deps.billing, (m) => deps.log.warn({}, m));
  },

  'export.generate': async (deps, job) => {
    const { exportId } = job.payload as { exportId: string };
    const row = await withTx(deps.pool, sys('export'), (tx) => ops.findExport(tx, exportId));
    if (!row || row.status !== 'pending') return;
    const data = await withTx(deps.pool, sys('export'), (tx) =>
      exportData.studentExportData(tx, row.studentId),
    );
    const objectKey = `exports/${exportId}.json`;
    await deps.storage.put(
      objectKey,
      Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), ...data }, null, 2)),
      'application/json',
    );
    await withTx(deps.pool, sys('export'), (tx) =>
      ops.markExportReady(
        tx,
        exportId,
        objectKey,
        new Date(Date.now() + productDefaults.exportRetentionDays * 86_400_000),
      ),
    );
  },

  'export.purge': async (deps) => {
    const expired = await withTx(deps.pool, sys('export-purge'), (tx) => ops.expiredExports(tx));
    for (const e of expired) {
      if (e.objectKey) await deps.storage.remove([e.objectKey]);
      await withTx(deps.pool, sys('export-purge'), (tx) => ops.markExportExpired(tx, e.id));
    }
  },

  'deletion.execute': async (deps, job) => {
    const p = job.payload as {
      requestId: string;
      scope: 'student' | 'account';
      accountId: string;
      studentIds: string[];
    };
    // Fetch the notification address before the Auth identity disappears.
    const notifyTo = await deps.authAdmin.getUserEmail(p.accountId).catch(() => null);
    for (const studentId of p.studentIds) {
      const keys = await withTx(deps.pool, sys('deletion'), (tx) =>
        ops.exportObjectKeysForStudent(tx, studentId),
      );
      await deps.storage.remove(keys);
      await withTx(deps.pool, sys('deletion'), async (tx) => {
        await accounts.revokeAllChildSessions(tx, studentId);
        await ops.scrubStudentReferences(tx, studentId);
        await accounts.deleteStudentRow(tx, studentId);
      });
    }
    if (p.scope === 'account') {
      await withTx(deps.pool, sys('deletion'), (tx) => accounts.deleteAccountRow(tx, p.accountId));
      await deps.authAdmin.deleteUser(p.accountId);
    }
    await withTx(deps.pool, sys('deletion'), async (tx) => {
      await ops.completeDeletionRequest(tx, p.requestId);
      await ops.insertAudit(tx, {
        actor: 'system:deletion',
        action: 'deletion.completed',
        targetType: p.scope,
        targetId: p.scope === 'account' ? p.accountId : (p.studentIds[0] ?? null),
        metadata: { requestId: p.requestId, students: p.studentIds.length },
      });
    });
    if (notifyTo) {
      await deps.email.send({
        to: notifyTo,
        template: 'deletion_complete',
        data: { scope: p.scope },
        idempotencyKey: `deletion:${p.requestId}`,
      });
    }
  },

  'maintenance.purge': async (deps) => {
    await withTx(deps.pool, sys('maintenance'), async (tx) => {
      await accounts.purgeExpiredChildSessions(tx, productDefaults.expiredTokenPurgeDays);
      await accounts.purgeExpiredGrants(tx, productDefaults.expiredTokenPurgeDays);
      await ops.purgeExpiredIdempotencyKeys(tx);
      await accounts.purgeRevokedPushTokens(tx, 30);
    });
  },

  'parent.summary': async (deps, job) => {
    const { weekStartDate } = job.payload as { weekStartDate: string };
    const flags = await withTx(deps.pool, sys('summary'), (tx) => ops.getFlags(tx));
    if (!flags.reminders) return;
    const rows = await withTx(deps.pool, sys('summary'), (tx) =>
      accounts.accountsWithReminderConsent(tx),
    );
    const byAccount = new Map<string, typeof rows>();
    for (const r of rows) byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r]);
    for (const [accountId, students] of byAccount) {
      const to = await deps.authAdmin.getUserEmail(accountId);
      if (!to) continue;
      const summaries = [];
      for (const s of students) {
        const from = weekStartDate;
        const until = addDays(weekStartDate, 6);
        const days = await withTx(deps.pool, sys('summary'), (tx) =>
          practice.progressDailyRange(tx, s.studentId, from, until),
        );
        summaries.push({
          nickname: s.nickname,
          completedSessions: days.reduce((n, d) => n + d.completedSessions, 0),
          firstAttempts: days.reduce((n, d) => n + d.firstAttemptCount, 0),
          correct: days.reduce((n, d) => n + d.correctCount, 0),
        });
      }
      await deps.email.send({
        to,
        template: 'parent_summary',
        data: { weekStart: weekStartDate, children: summaries },
        idempotencyKey: `summary:${accountId}:${weekStartDate}`,
      });
    }
  },
};

export function backoffDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

/**
 * Claims due jobs in a short transaction (FOR UPDATE SKIP LOCKED + lease), commits, then runs the
 * external work. Failures retry with bounded exponential backoff; after the configured attempts a
 * job is dead-lettered with an operator alert.
 */
export async function runJobsOnce(deps: Deps, opts: { limit?: number; types?: string[] } = {}) {
  const claimed = await withTx(deps.pool, sys('job-claim'), (tx) =>
    ops.claimJobs(tx, { limit: opts.limit ?? 10, leaseSeconds: productDefaults.jobLeaseSeconds }),
  );
  let done = 0;
  let failed = 0;
  for (const job of claimed) {
    const handler = jobHandlers[job.type];
    try {
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      await handler(deps, job);
      await withTx(deps.pool, sys('job-complete'), (tx) =>
        ops.completeJob(tx, job.id, job.type === 'deletion.execute'),
      );
      done++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      const dead = job.attempts >= productDefaults.jobMaxAttempts;
      await withTx(deps.pool, sys('job-fail'), async (tx) => {
        await ops.failJob(tx, {
          id: job.id,
          error: message,
          retryAt: dead ? null : new Date(Date.now() + backoffDelayMs(job.attempts)),
        });
        if (dead) {
          await ops.raiseOpsAlert(tx, {
            kind: 'job_dead_letter',
            dedupeKey: `dead:${job.id}`,
            details: { type: job.type, attempts: job.attempts },
          });
        }
      });
      deps.log.error({ jobId: job.id, type: job.type, attempts: job.attempts, dead }, 'job failed');
    }
  }
  return { claimed: claimed.length, done, failed };
}

/** Enqueues periodic jobs; dedupe keys make repeated calls within a window no-ops. */
export async function schedulePeriodicJobs(deps: Deps, now = new Date()) {
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const utcDate = localDateIn('UTC', now);
  const lastWeek = weekStart(addDays(utcDate, -7));
  await withTx(deps.pool, sys('scheduler'), async (tx) => {
    await ops.enqueueJob(tx, { type: 'billing.sweep', dedupeKey: `billing.sweep:${hour}` });
    await ops.enqueueJob(tx, { type: 'maintenance.purge', dedupeKey: `maintenance.purge:${day}` });
    await ops.enqueueJob(tx, { type: 'export.purge', dedupeKey: `export.purge:${day}` });
    await ops.enqueueJob(tx, {
      type: 'parent.summary',
      dedupeKey: `parent.summary:${lastWeek}`,
      payload: { weekStartDate: lastWeek },
    });
  });
}
