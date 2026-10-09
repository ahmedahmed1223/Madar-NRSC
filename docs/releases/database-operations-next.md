# Next Release: Database Operations (Draft)

Prepared 2026-10-09. Not published; the released version remains 3.23.0.

## Arabic Release Notes

- زر «إنشاء نسخة احتياطية الآن» ظاهر أعلى مدير قاعدة البيانات، مع انتظار تأكيد الخادم ومنع النقر المكرر.
- تنبيهات عدم وجود نسخة وتأخر النسخ وفشل المحاولة، مع تمييز فشل إكمال حزمة الملفات أو إرسالها خارجياً.
- فحص سلامة SQLite وتوافق النسخة وبصمة SHA-256 دون استعادة أو تغيير البيانات.
- تحميل النسخة المحددة من صفها بدلاً من تنزيل قاعدة البيانات الحالية.
- تبويب «آخر أخطاء الخادم» للبحث بالوصف أو رقم التتبع، وآخر 100 رسالة تشغيل منقحة محفوظة عبر إعادة التشغيل.
- تجربة استعادة على نسخة مؤقتة معزولة، مع توافق المخطط وأعداد السجلات، دون لمس البيانات الحالية.
- تأكيد كلمة المرور والمصادقة الثنائية عند تفعيلها قبل الاستعادة أو إعادة التهيئة، بتأكيد مؤقت لمرة واحدة مرتبط بالجلسة والعملية وبصمة النسخة.
- منع الاستعادة أثناء الهواء، وإقرار صريح بانتهاء جلسات الهواء المحلية غير المتصلة.
- استعادة باستخدام نسخة ثابتة واستبدال ذري، لحماية المصدر من تدوير النسخ والقاعدة الحالية من فشل النسخ الجزئي.
- تنبيهات حوادث النسخ والتعافي لمديري القاعدة، مع منع التكرار واحترام إعدادات القنوات وساعات الهدوء.
- تنزيل تقرير تشخيص يتضمن الإصدار والجاهزية وحالة النسخ والأخطاء دون الأسرار أو النصوص الخام أو المسارات.
- تبويبات تدعم لوحة المفاتيح، وأدوات إدارة قابلة للاستخدام على الجوال وسطح المكتب.

## Boundaries

- All new endpoints require `system.database_manage`; error/report/download responses are no-store.
- Error labels are allowlisted. Raw error fields, request URLs, credentials and newsroom content are not exported. Unknown messages become `server error`.
- Sanitized errors persist in a private journal: one active file plus four archives, up to 1 MiB each. Retention is size-bounded, not a guaranteed period or immutable forensic archive. Disk failure degrades journal health without stopping requests.
- Manual backups and row downloads are SQLite snapshots only. Complete database/upload bundles and configured off-site delivery belong to scheduled backup delivery.
- Integrity verification checks the selected snapshot at the time of verification; restore revalidates it. A newly computed SHA-256 is not an authenticated historical checksum or a promise that uploaded media are present.
- Incident reconciliation runs each minute and after backup outcomes. Existing system-notification email/push defaults remain disabled unless the manager enables them. Bell notifications persist; quiet-hour delivery follows existing worker behavior.
- Destructive operations require fresh confirmation and no shared active air. Offline local air cannot be detected centrally, so operator acknowledgement is required. Server reset configuration remains authoritative.
- Rehearsal requires the current schema migration versions and required columns; older migratable backups may require recovery under their matching application version. Uploaded media and external integrations are not certified.

## Prior Administration Baseline

- RED: missing new routes and error collector; UI missing requested button.
- Server tests: manager-only access, redacted error/report payloads, bounded immutable error copies, selected-file bytes, traversal rejection, corrupt snapshot rejection, no revision changes, missing/overdue backups and failed delivery.
- Browser journey: create/failure/retry/duplicate click, verify/download, error refresh failure/retry, search, keyboard tabs, report download, axe and overflow at 390px/1440px.
- Final focused browser regression: 12/12 passed (46.9 seconds), including administration, help, settings and smoke journeys. The administration journey includes axe/overflow at 390px/1440px in light/dark and keyboard checks. Screenshots inspected; duplicate floating backup-failure notification removed in favor of the in-page alert.
- Five focused server tests passed, including an injected snapshot-write failure and its redacted last-error record.
- Final `npm run check` passed: TypeScript, 264/264 unit/server tests across 55 files, and production build. No complete 101-test browser rerun is claimed for this bounded change; the 12 focused browser tests above passed on the final feature build.
- Local preview restarted with demo seeding disabled on 127.0.0.1:3000. Health and readiness passed, database identity unchanged, test-only bundle absent. Changes remain on `codex/database-operations`; no merge, push or version publication was performed.

## Current Safety Verification

- RED/GREEN: isolated rehearsal, retention-one source loss, failed atomic replacement, scoped reauthentication, TOTP replay, active-air race, durable journal, request correlation and incident deduplication.
- Browser verification covers incorrect-password retry without logout, air conflict, expired confirmation, duplicate execution prevention, conditional TOTP, Escape/focus restoration, rehearsal, selected download and diagnostics.
- Final post-review `npm run check`: 295/295 tests across 61 files, TypeScript and production build passed.
- Final focused browser regression: 12/12 passed in 49.7 seconds; mobile/desktop, day/night, keyboard, axe and overflow checked. Mobile confirmation screenshot inspected: background sticky controls are covered and failed confirmation returns focus to the password field.
- Independent read-only review found one important incident-retry issue. Fixed using a persistent transition outbox separate from notification insertion; failure followed by success and recovery followed by failure are covered by regression tests. No critical or minor findings were raised.
- Additional tests prove explicit delegated database permission, revocation, account deactivation, and startup cleanup preserving unrelated directories and rejecting linked roots.
- No live restoration/reset, merge, push or version change performed.

## Implementation Decisions

- Work in the existing feature branch to preserve its administration groundwork; no separate checkout isolation, but all tests use temporary data.
- Require matching schema migrations and required columns; older snapshots need a matching-version recovery procedure.
- Block shared `LIVE` and defensive `RUNNING`/`PAUSED` states; conservative legacy-state rejection is possible.
- Extend existing server-generated request IDs; background work receives an independent UUID when no request context exists.
- Use same-volume atomic replacement; platforms refusing replacement abort while retaining the original file.
- Preserve the signed-in UI only for exact scoped confirmation-error codes; genuine session expiry still logs out.
- Use a body portal and restore focus after failed confirmation; accessibility and global theme styles were verified.
- Wait for finite theme animations before contrast tests; assertions cover terminal colors rather than transition frames.
- Initialize the existing delivery cursor before startup alerts; historical notifications remain intentionally excluded from first-run delivery.
- Retain existing Tailwind/common Modal instead of introducing a UI dependency; new controls rely on the application's existing theme system.

Historical session contents restored by a database snapshot remain existing behavior. Transport-level exactly-once SMTP delivery across a crash is not guaranteed. Complete-bundle media restoration is outside this slice.

## Proposed Follow-Up Features (Not Implemented)

1. Immutable checksum manifests and end-to-end verification for complete off-site database/upload bundles.
2. A separate isolated media recovery rehearsal for complete bundles.
