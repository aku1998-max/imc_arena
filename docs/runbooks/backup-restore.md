# Backups and restore drill

Provisional targets: **RPO 24 hours, RTO one working day.** Confirm the hosting plan meets them
(daily backups at minimum; PITR preferred).

Drill (staging, at least before pilot and then quarterly):

1. Restore the latest production-shaped staging backup into a new, isolated project.
2. Run `pnpm db:migrate` against it (must report only already-applied migrations).
3. Point a staging API at it; run the smoke checks: `/ready`, sign in as a test parent, load a
   child home, start/answer a daily session, open the admin question list.
4. Run the RLS verification query from `packages/db/test/migrate.test.ts`.
5. Record duration (vs RTO), data window (vs RPO) and issues. Delete the restored project.

Storage objects (content images, exports) need their own backup policy in the storage provider.
