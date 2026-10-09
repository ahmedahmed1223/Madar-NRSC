# Database Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Equip database managers with rehearsed recovery, secure destructive operations, durable sanitized errors, and backup incident notifications.

**Architecture:** Keep existing permission and delivery systems authoritative. Introduce focused recovery, confirmation, journal, and incident modules; integrate them through existing routes and scheduled jobs. Implement recovery first, then independently test journal and notification slices before the combined UI journey.

**Tech Stack:** TypeScript, Express, better-sqlite3, React, existing Vitest/Supertest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-database-safety-design.md`

## Global Constraints

- Require `system.database_manage` server-side; do not grant every ADMIN this permission or bypass `ALLOW_DB_RESET`.
- Confirmation tokens are single-use, session/action/actor-bound, valid for two minutes, and hash-bound for restoration.
- Block destructive operations for running or paused shared broadcasts; explicitly acknowledge undetectable disconnected local sessions.
- Journal: latest 100 API entries; active file plus four rotated files, at most 1 MiB each; sanitized labels only.
- Incident reminders no more than once per 24 hours; respect existing channel preferences and quiet hours.
- No production database restoration during tests, no new dependencies, no merge/push/version change in this plan.
- Preserve all existing uncommitted database-administration improvements and Arabic RTL conventions.

## Review Focus

- Low backup retention must not delete the selected restoration source (Task 1).
- A snapshot replaced after confirmation must not be restored (Task 2).
- Broadcast state changing during password verification must block execution (Task 2).
- Disk exhaustion or malformed journal records must not break requests (Task 3).
- Worker restart and notification-storage failure must not duplicate incident alerts (Task 4).

## Task 1: Isolated Recovery and Operation Lock

**Files:** Create `src/server/databaseRecovery.ts`, `tests/server/databaseRecovery.test.ts`; modify `src/server/db.ts`, `src/server/app.ts`, `src/shared/databaseDiagnostics.ts`.

**Interfaces:** Export `DatabaseOperationLock.run<T>(work: () => Promise<T>): Promise<T>` (reject busy, no queue). Export `rehearseBackup(db: NewsroomDatabase, fileName: string, tempRoot: string): Promise<BackupRehearsal>` and `cleanupRehearsals(tempRoot: string): Promise<void>`. Define `BackupRehearsal` with filename, SHA-256, application version, checkedAt, compatible boolean, collection counts, and fixed media limitation. Add `restoreBackup(fileName: string, retention: number, expectedHash?: string): Promise<void>` using a stable validated temporary copy.

- [ ] Write failing tests `rehearsalLeavesLiveRevisionUnchanged`, `rejectsMalformedAndIncompatibleSnapshot`, `cleansAfterCopyFailure`, `rejectsConcurrentOperation`, and `restorePreservesSourceAtRetentionOne`. Assert unchanged live identity/revision and no notification rows after rehearsal; fail-closed for symlink/path traversal.
- [ ] Run `npx vitest run tests/server/databaseRecovery.test.ts`; expect failures on missing recovery behavior.
- [ ] Implement read-only temporary probing with SQLite integrity/schema checks and aggregate counts. Derive required schema from current migrations, never instantiate the live constructor against the probe. Validate cleanup paths and remove only uniquely named rehearsal directories. Snapshot hash must cover the stable copy that is probed/restored.
- [ ] Route rehearsal at POST `/api/v1/db/backups/rehearse`, using existing permission/CSRF and fixed public errors. Share an operation lock across manual backup, scheduled backup, rehearsal, restore, and reset; skip busy scheduled attempts without recording a backup failure. Abort reset/restore if pre-operation backup fails.
- [ ] Run recovery tests plus `tests/server/databaseDiagnostics.test.ts`; expect all green, including corrupted snapshots and retention protection.
- [ ] Commit only Task 1 files and hunks: `feat: add isolated database recovery rehearsal`.

## Task 2: Reauthentication and Destructive-Operation Guards

**Files:** Create `src/server/databaseConfirmation.ts`, `tests/server/databaseConfirmation.test.ts`, `tests/server/databaseDestructiveOperations.test.ts`; modify `src/server/app.ts`, `src/server/db.ts` only for necessary credential/session access.

**Interfaces:** Export `DatabaseConfirmations.issue(binding: { actorId: string; sessionId: string; action: 'restore' | 'reset'; sha256?: string }, now?: number): { token: string; expiresAt: string }` and `consume(token: string, binding: same, now?: number): boolean`. Tokens use cryptographic random bytes, bounded in-memory storage, atomic consumption, and 120000 ms expiry. Add POST `/api/v1/db/confirm-operation` accepting action, optional filename, password, and optional totp; restore/reset accept confirmationToken and `localAirEnded: true`.

- [ ] Write failing token tests for expiry, reuse, wrong session/actor/action/hash, and restart invalidation. Write API tests for 401/403, missing CSRF, delegated/revoked permission, password failure, enabled/disabled TOTP, replay, inactive actor, and disabled reset.
- [ ] Run both new test files; expect missing confirmation/guard failures.
- [ ] Reuse current password and TOTP helpers with a dedicated account-plus-IP limiter: five failed attempts per 15 minutes. Do not return or log supplied credentials/tokens. Resolve session identity from authenticated server context, never request body. Check role and session anew on execution.
- [ ] Inside the operation lock, recheck current `onAir` rows for running/paused states, selected hash and configuration immediately before consuming the token. Reject shared active air with 409, missing local-session acknowledgement with 400, and invalid confirmation with fixed 401. Audit outcome and actor using fixed descriptions. Catch restoration failures without leaking paths; preserve existing rebootstrap semantics.
- [ ] Add race tests `airStartsDuringReauthentication` and `snapshotReplacedAfterConfirmation`, plus duplicate requests and failed pre-backup. Run confirmation, destructive-operation and recovery suites; expect all green.
- [ ] Commit scoped files/hunks: `feat: secure destructive database operations`.

## Task 3: Persistent Sanitized Journal and Correlation

**Files:** Create `src/server/errorJournal.ts`, `src/server/requestCorrelation.ts`, `tests/server/errorJournal.test.ts`; modify `src/server/logger.ts`, `src/server/app.ts`, `src/shared/databaseDiagnostics.ts`, `server.ts`, `tests/server/recentErrors.test.ts`.

**Interfaces:** Export `ErrorJournal.open(directory: string): Promise<ErrorJournal>`, `append(entry: RecentServerError): void`, `snapshot(): RecentServerErrors`, `flush(): Promise<void>`, `close(): Promise<void>`, and `health(): 'ok' | 'degraded'`. Export request correlation middleware using AsyncLocalStorage; `currentCorrelationId(): string | undefined`. Recent errors retain id/at/message, with UUID id reused as correlation ID. Expose journal health in diagnostic reports.

- [ ] Write failing tests for restart recovery, latest100 immutable snapshots, allowlist redaction, truncated/malformed lines, rotation at 1048576 bytes, four retained archives, unwritable disk, bounded queue, and no recursive journal error.
- [ ] Run `npx vitest run tests/server/errorJournal.test.ts tests/server/recentErrors.test.ts`; expect missing persistence failures.
- [ ] Implement asynchronous serialized append with a queue capped at 1000 records; overflow marks degraded without affecting requests. Validate loaded records against fixed labels, ISO timestamps, UUIDs, and size limits. Use a private server-controlled journal directory, reject symlinks, and initialize before listening. Flush on normal shutdown; never copy raw logger fields.
- [ ] Add server-generated `X-Request-ID` on API responses; ignore incoming IDs. Logger obtains request context or creates a background UUID. Keep current stdout/stderr behavior, but never expose their fields through journal APIs.
- [ ] Add HTTP tests asserting response/error ID equality and concurrent-request isolation; run journal/recent-errors/diagnostics suites, expect all green.
- [ ] Commit scoped files/hunks: `feat: persist sanitized operational errors`.

## Task 4: Deduplicated Backup Incident Notifications

**Files:** Create `src/server/backupIncidents.ts`, `tests/server/backupIncidents.test.ts`; modify `server.ts`, `src/server/databaseDiagnostics.ts`, existing notification helpers only where necessary.

**Interfaces:** Export `reconcileBackupIncidents(db: NewsroomDatabase, status: BackupStatus, now?: number): Promise<void>`. Incident keys are snapshot-failure, delivery-failure, and overdue. Store active state, generation, lastNotifiedAt and pending transitions in server metadata. Generate deterministic notification IDs from incident generation, transition and recipient to make retries idempotent.

- [ ] Write failing tests for one opening alert, 24-hour reminder boundary, one recovery, restart, failed notification persistence, manual snapshot not resolving delivery failure, disabled schedule, revoked/inactive manager, and category/channel preferences.
- [ ] Run `npx vitest run tests/server/backupIncidents.test.ts`; expect missing reconciler failures.
- [ ] Use existing permission evaluation for recipients and existing notification insertion/delivery. Make notifications non-urgent and categorized consistently with existing system notifications; no separate SMTP/push calls. Commit metadata transitions only with corresponding notification writes, or keep durable pending transitions for retry. Poll overdue state through existing maintenance timer; run after scheduled/manual backup results. Notification errors never redefine backup outcome or recurse.
- [ ] Add tests with existing delivery worker for quiet hours and disabled email/push, and storage recovery without duplicate alert. Run incident and current delivery suites; expect all green.
- [ ] Commit scoped files/hunks: `feat: notify database managers of backup incidents`.

## Task 5: Manager Interface and End-to-End Verification

**Files:** Create `src/components/database/DatabaseOperationConfirmation.tsx`; modify `src/views/DatabaseManagerView.tsx`, `src/components/database/DatabaseErrorsPanel.tsx`, `src/services/api.ts`, `src/content/help.ts`, `tests/e2e/database-operations.spec.ts`, `docs/releases/database-operations-next.md`.

**Interfaces:** Add typed API methods `rehearseBackup(fileName): Promise<BackupRehearsal>` and `confirmDatabaseOperation(input): Promise<{token: string; expiresAt: string}>`; pass token/localAirEnded through existing restore/reset methods. Confirmation component consumes action/filename/TOTP requirement and completion callback; no browser persistence of secrets.

- [ ] Extend browser tests first: rehearsal results, bad-password retry, conditional TOTP, explicit local-air acknowledgement, active-air rejection, expired confirmation, guarded duplicate submit, journal search by UUID, degraded state, and incident/recovery messages.
- [ ] Run serial database-operations suite using isolated E2E server; expect missing UI assertions to fail.
- [ ] Implement existing-style RTL controls/dialogs with 44px targets, inline errors, Escape and focus restoration, and secret clearing. Obtain TOTP requirement from trusted current account security state. Render fixed rehearsal limitations and correlation IDs; retain current selected-download and manual-backup behavior. Update help and draft release boundaries.
- [ ] Run `npm run check` with Git bash tools on PATH. Run Playwright database-operations, help, settings-controls, settings and smoke suites serially; verify 390/1440 widths, day/night themes, no horizontal overflow, axe checks, keyboard and no page errors. Build once before browser runs, not during them.
- [ ] Review complete diff for permission leaks, secrets, destructive test targets and compatibility. Record actual counts/results in release draft; do not reuse earlier test counts as new evidence.
- [ ] Commit scoped changes: `feat: complete database safety administration experience`. Restart local preview only after successful build and verify health/readiness and unchanged live database identity. Stop isolated test server; leave local preview running. Report what shipped locally and any remaining limitations without claiming merge/push.
