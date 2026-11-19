# Production Operations

## Complete Backups

Scheduled backups and the «نسخة احتياطية كاملة الآن» button (Database screen) run the same
code (`createFullBackup`) and create a `.sqlite.bundle` folder containing `newsroom.sqlite`,
all uploads referenced by that snapshot, and a SHA-256 manifest. Database integrity,
upload sizes and copied file checksums are checked before successful delivery is logged.
Missing files fail the backup instead of producing a success message.

- `BACKUP_DIRECTORY`: an absolute folder outside `DATA_DIR`, on another disk or a mounted network share.
  `docker-compose.yml` mounts a separate `nrcs-backups` volume at `/backups` and sets `BACKUP_DIRECTORY=/backups`;
  bind that volume to another disk so losing the data volume does not lose the backups.
- `BACKUP_REMOTE`: `remote:path` configured in rclone (S3-compatible storage, Azure Blob, Google Cloud Storage, or another supported backend).
- Both can be enabled together. Empty values keep complete bundles locally only.
- rclone must be installed on the host/container and its configuration made available to the service account.
  The stock image does not include rclone. Keep credentials outside Git; use provider encryption and restricted access.
- Local complete bundles follow `BACKUP_RETENTION`. External retention must be configured separately,
  preferably with provider lifecycle/versioning. Remote destinations are never deleted by the application.
- Failed `.pending` bundles are not complete backups. Investigate the error before manually removing them.
- When no backup exists or the last one is overdue, a backup runs one minute after start-up (so a server
  restarted more often than the interval still backs up); otherwise the next one follows the interval.
- Downloading a backup file or the database (`/api/v1/db/backups/download`, `/api/v1/db/export`) needs a
  one-time token from `/api/v1/db/confirm-operation` (password, plus the authenticator code when enabled)
  and is written to the audit log (`DB_BACKUP_DOWNLOAD`, `DB_EXPORT`). These files hold every password hash.
- «تصدير بيانات العمل الحالية (JSON)» in the settings is not a backup: it holds only what the browser
  downloaded (no accounts, no uploads, no archived news older than `NEWS_ACTIVE_DAYS`).

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

## Deployment Checklist

- **Port and proxy.** Compose binds `127.0.0.1:3000`. Put an HTTPS reverse proxy in front and set
  `TRUST_PROXY` only then (`loopback` for a proxy on the host, `1` for a proxy container with the app
  port unpublished). `TRUST_PROXY` with the port open to the network lets anyone forge
  `X-Forwarded-For`: login rate limits and audit IP addresses become meaningless.
- **Cookies.** `COOKIE_SECURE=true` (default in production) needs HTTPS. `false` is reported as a
  deployment warning (log and «مراقبة النظام»).
- **Time zone.** Set `TZ` (compose defaults to `Asia/Riyadh`; the image contains tzdata). Quiet hours
  follow the station zone in the settings, independent of `TZ`.
- **Logs.** One JSON line per API request on stdout; compose limits the json-file log to 5 × 20 MB.
- **Demo data.** With `NODE_ENV=production` the server refuses to start with `SEED_DEMO_DATA=true`
  unless `ALLOW_DEMO_IN_PRODUCTION=true`. At start-up it checks which accounts still use
  `DEMO_USER_PASSWORD` and lists them as an alert until their passwords change.
- **First administrator.** Whether generated or from `ADMIN_PASSWORD`, the first password must be changed
  at first sign-in. Remove `ADMIN_PASSWORD` from `.env` afterwards. A generated password is printed once
  in the log: rotate the log or change it promptly.
- **Temporary passwords.** While an account must change its password, the server answers every API
  call except `/auth/me`, `/auth/logout` and `/auth/change-password` with 403
  `PASSWORD_CHANGE_REQUIRED`. Temporary passwords issued by an administrator expire after
  `TEMP_PASSWORD_HOURS` (72). Each person keeps at most 10 signed-in devices.
- **Health.** `/api/health` shows `dbId`/`instance` to signed-in users only; use `/api/ready` for probes.
- **Audit trail.** Only the server writes audit entries (accounts, roles, permission exceptions,
  suspensions, stations, departments, settings, backups and downloads); browsers cannot add rows.
- **rclone.** The stock image has no rclone; `BACKUP_REMOTE` needs an image that adds it.
