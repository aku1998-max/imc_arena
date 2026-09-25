# Runbooks

| Runbook                                        | When                                                      |
| ---------------------------------------------- | --------------------------------------------------------- |
| [wrong-answer-key.md](wrong-answer-key.md)     | A published question has a materially wrong key           |
| [lost-paid-access.md](lost-paid-access.md)     | A parent paid but the child has no Pro access             |
| [compromised-device.md](compromised-device.md) | A child device is lost/shared or behaves suspiciously     |
| [database-incident.md](database-incident.md)   | Data loss/corruption or a bad migration                   |
| [content-shortage.md](content-shortage.md)     | `CONTENT_UNAVAILABLE` alerts                              |
| [database-roles.md](database-roles.md)         | Creating the migration/runtime roles on a hosted database |
| [deployment.md](deployment.md)                 | Environments, CI/CD gates, rollout, rollback, flags       |
| [backup-restore.md](backup-restore.md)         | Backup policy and the staging restore drill               |
| [paid-gate.md](paid-gate.md)                   | Turning on purchases                                      |

All production actions need project-owner authorization. Record every manual action in the
audit log (admin UI actions are audited automatically; CLI scripts write their own audit rows).
