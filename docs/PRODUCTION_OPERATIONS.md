# Production Operations

## Complete Backups

Scheduled backups now create a `.sqlite.bundle` folder containing `newsroom.sqlite`,
all uploads referenced by that snapshot, and a SHA-256 manifest. Database integrity,
upload sizes and copied file checksums are checked before successful delivery is logged.
Missing files fail the backup instead of producing a success message.

- `BACKUP_DIRECTORY`: an absolute folder outside `DATA_DIR`, on another disk or a mounted network share.
- `BACKUP_REMOTE`: `remote:path` configured in rclone (S3-compatible storage, Azure Blob, Google Cloud Storage, or another supported backend).
- Both can be enabled together. Empty values keep complete bundles locally only.
- rclone must be installed on the host/container and its configuration made available to the service account.
  The stock image does not include rclone. Keep credentials outside Git; use provider encryption and restricted access.
- Local complete bundles follow `BACKUP_RETENTION`. External retention must be configured separately,
  preferably with provider lifecycle/versioning. Remote destinations are never deleted by the application.
- Failed `.pending` bundles are not complete backups. Investigate the error before manually removing them.
- Automatic backups start after the configured interval, not immediately after every restart.

## Recovery Drill

Restore into an isolated environment, never over the live database during verification.
Verify every manifest hash, stop the target server, then restore `newsroom.sqlite` and
`uploads/` together into an empty `DATA_DIR`. Preserve the original live volume first.
Start the same application version and test login, media access and a newsroom workflow.
Record recovery duration and the timestamp of the newest recovered write. A real cloud
delivery and recovery drill are still required before claiming production readiness.

## Shutdown And Traffic

On termination, readiness becomes 503, new API requests receive 503 with Retry-After,
and SSE streams close separately. Existing requests may drain until the 10-second deadline.
Long uploads exceeding this deadline can still be interrupted; schedule deployment outside
large uploads or increase the application/container deadlines together.

Health probes bypass traffic quotas. Authenticated quotas are per user; a wider per-IP
limit protects the server before session processing. Configure trusted proxies accurately.
Monitor disk capacity, backup failures, HTTP latency, 429/503 rates and sync errors.

## Release Gate

CI now runs critical browser workflows in addition to unit tests, type checks, build and
production smoke tests. Keep a single application instance with persistent SQLite storage.
Load testing, metrics/alerts, automatic failover and server-side pagination are separate
remaining work; these changes do not promise zero downtime or zero data loss.
