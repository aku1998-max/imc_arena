# Database incident

1. **Stop risky writes:** set flags `new_sessions=false` and `answer_submissions=false`
   (admin `POST /v1/admin/flags` or owner SQL). Committed attempts are preserved; the app shows a
   clear service message and never grades locally. Scale the worker to zero if jobs are involved.
2. **Restore in an isolated environment** from the latest good backup/PITR point (see
   backup-restore.md). Never restore over production first.
3. **Validate integrity:** migrations table matches the repo; row counts; RLS forced on all app
   tables (`packages/db/test/migrate.test.ts` query); sample family isolation checks; answer keys
   present for every published version.
4. **Coordinate recovery:** decide cut-over or targeted repair with the project owner; record
   the timeline, data window lost (target RPO 24 h) and user communication.
5. Re-enable flags, watch error rate and job failures.
