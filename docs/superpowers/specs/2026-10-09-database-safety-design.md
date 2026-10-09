# Database operations safety

Date: 2026-10-09
Status: Design for user review; not implemented.

## Intent

Give the system administrator practical recovery and troubleshooting tools without risking live broadcasts or exposing newsroom content. Preserve the existing manual SQLite backup, verification, selected-file download, diagnostics, and recent-errors interface. These additions are a next-release candidate, not a change to the published 3.23.0 release.

## Authority and boundaries

All new operations require the existing `system.database_manage` permission on the server. The system administrator retains this permission; authorized administrators can delegate it through existing role management. Do not silently grant it to every ADMIN, news editor, or producer. UI visibility is not authorization.

The administrator can create and download backups, rehearse restoration, inspect diagnostics, and perform permitted restoration/reset operations. Server configuration remains authoritative: `ALLOW_DB_RESET` is not bypassed or enabled through the browser, and SQL remains read-only with its existing configuration gate. No universal bypass or live-broadcast override is added.

## Isolated restoration rehearsal

Add an authenticated, CSRF-protected rehearsal action for an existing selected SQLite snapshot. Resolve the name through the existing strict path validation; reject links and arbitrary paths. Permit one rehearsal at a time per server and return a clear busy response.

Copy the selected snapshot into a unique temporary directory under the server-controlled data directory. Open only that copy, without seeding or connecting it to synchronization, notification workers, or the live database. Check SQLite integrity and schema compatibility with the running application, and report aggregate collection counts and media-reference limitations. Never return content rows, credentials, absolute paths, or raw SQL errors.

Return a report bound to the snapshot SHA-256, application version, and completion time. A successful rehearsal does not certify uploads, external integrations, or historical authenticity. Clean up the temporary directory on success and failure; clean abandoned rehearsal directories at startup using verified workspace-contained paths. Failure leaves the live database and its revision unchanged.

## Destructive-operation confirmation

Before restore or reset, require the current user's password and a fresh TOTP only when that user already has TOTP enabled. Reuse existing password verification and TOTP replay protection. Do not require enrollment as a condition of recovery. Apply a dedicated rate limit and generic authentication failure messages.

Issue an opaque, server-held, single-use confirmation valid for two minutes. Bind it to the actor, current authenticated session, operation, and selected snapshot hash for restore. Never persist passwords, TOTP codes, or confirmation tokens in browser storage, logs, reports, or audit metadata. A changed snapshot, revoked permission, expired session, consumed token, or restart invalidates authorization.

At execution, recheck permission, configuration, snapshot identity, and current shared on-air state. Block destructive operations while any shared broadcast is running or paused. Explain which broadcasts must be ended without taking control of them. Disconnected local broadcasts cannot be reliably detected; display this limitation and require explicit operator confirmation that all local air sessions have ended.

Serialize destructive operations with rehearsal and backup operations. Preserve the selected source from retention pruning by using a validated stable copy before the pre-operation backup. Require a successful pre-operation backup; failure aborts the operation. Consume confirmation atomically before destructive work. Audit actor, action, outcome, and correlation ID without secrets. Return fixed errors instead of exposing filesystem exceptions. Preserve current restore synchronization/session behavior unless focused tests show a necessary correction.

## Persistent sanitized error journal

Extend the current logger with a dedicated journal outside the restorable SQLite database, under the private data directory. Persist only allowlisted message labels, server-generated UUID correlation IDs, and timestamps. Unknown messages remain `server error`; no raw fields, stack traces, URLs, paths, tokens, or newsroom text are copied.

Use JSON Lines with a bounded write queue and rotation: active file plus four rotated files, each at most 1 MiB. The UI/API still returns the latest 100 entries. Startup tolerates a truncated final line and rejects malformed records. Journal failures must not recurse through the journal or terminate application requests; report degraded journal health using a fixed diagnostic flag and existing stderr logging.

Generate request correlation IDs on the server, attach them to responses, and reuse them for associated sanitized errors. Background jobs generate their own IDs. Do not trust incoming IDs. Restrict the journal APIs and exported diagnostics to database managers and retain `no-store`. Retention is bounded by size, not guaranteed duration; document that distinction.

## Backup incident notifications

Use the existing notification collection and delivery worker, not a second mail or push transport. Notify active users who currently hold database-management permission. Respect notification category/channel preferences and quiet hours; do not mark these notifications urgent to bypass them.

Track snapshot failure, scheduled complete-bundle delivery failure, and overdue automatic backups as separate incidents. Persist incident state so a restart does not duplicate alerts. Create one opening notification per incident, a reminder no more than once per 24 hours while unresolved, and one recovery notification after that same operation succeeds. A manual SQLite snapshot does not resolve a complete-bundle delivery incident. Disabled automatic scheduling does not create an overdue incident.

Notifications contain fixed descriptions and a link to database administration, never destinations, credentials, or raw errors. Notification failure does not alter backup success and must not create recursive notifications. When the database cannot accept a notification, retain the incident transition for retry without claiming delivery occurred.

## Interface and accessibility

Add a clearly named rehearsal control beside backup verification and show a structured result with counts, hash, compatibility, and limitations. Use existing confirmation dialogs for restore/reset, adding password and conditional TOTP fields only at confirmation time. Clear secrets on close or completion, restore focus, support Escape and keyboard navigation, and prevent duplicate submissions. Do not trigger destructive actions through generic save shortcuts.

Extend the errors panel with correlation-ID search and journal-health state. Show backup incident/recovery states alongside existing backup status. Preserve Arabic RTL, 44px touch targets, mobile wrapping, inline actionable errors, and current theme behavior. Update help to distinguish verification, rehearsal, actual restoration, database-only snapshots, and complete bundles.

## Verification and acceptance

Use isolated temporary databases only. Test unauthenticated and unauthorized access, delegated permission and revocation, CSRF, rate limits, TOTP replay, expired/cross-session/cross-action confirmation, snapshot replacement, duplicate execution, pre-backup failure, retention protection, concurrent operations, and running/paused broadcast rejection.

Prove rehearsal never changes live data/revision or starts workers and cleans temporary files after failure. Test journal restart recovery, malformed/truncated lines, rotation limits, queue failure, secret redaction, and correlation propagation. Test incident deduplication across restart, reminders, recovery, disabled schedule, per-user channel preferences, quiet hours, and unavailable notification storage.

Run focused API/unit tests, the repository check/build, and serial browser journeys on mobile and desktop in both themes, including keyboard focus and accessibility checks. Do not perform a production restoration as a test. Merge, push, and release-version changes require a separate explicit integration request.
