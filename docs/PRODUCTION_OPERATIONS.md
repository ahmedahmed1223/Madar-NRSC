# Production Operations

## تشغيل البناء وقياس الحمل

يقدّم خادم الإنتاج ملفات الواجهة من `dist/` ويشغّل Node من `dist-server/server.cjs`.
عند نسخ البناء يدويًا احتفظ بالمجلدين وشغّل `npm start` من جذر التطبيق.
اجعل جذر الويب في الوكيل العكسي منفصلًا عن ملفات الخادم وخرائط المصدر.

للقياس المحلي استخدم `npx tsx scripts/benchmark-newsroom.ts`. ينشئ القياس بيئة
SQLite مؤقتة و50 حسابًا وأربع محطات و5,000 خبر. يقيس المئين 95 لتسجيل الدخول
والتهيئة وحفظ التكليف وقراءة التغييرات والبحث في الأرشيف، ويطابق التكليفات
مع ما استلمه الزملاء. احفظ ناتج الأمر لكل نسخة على الجهاز نفسه. استخدم
المناوبة أدناه لقياس الوصول بين المحطات وعلى الأجهزة التي تستخدمها غرفة الأخبار.

## مناوبة مشتركة عبر المحطات

استخدم [ملف تشغيل المناوبة](../docker-compose.rehearsal.yml) على خادم مستقل يشغّل Docker Compose. وجّه اسم نطاق الاختبار إلى الخادم وأتح منافذ HTTP وHTTPS لإصدار الشهادة. يحفظ الملف بيانات المناوبة ونسخها الاحتياطية في مجلدات Docker مخصصة، ويمرّر الوصول إلى مدار عبر HTTPS.

أنشئ `.env.rehearsal` من `.env.example` واضبط `REHEARSAL_DOMAIN` باسم النطاق دون البروتوكول. عيّن `ADMIN_EMAIL` و`ADMIN_PASSWORD` لحساب مدير خاص بالمناوبة، واضبط `TZ` على توقيت المؤسسة. من جذر المشروع شغّل الأمر التالي.

```sh
docker compose --env-file .env.rehearsal -f docker-compose.rehearsal.yml up -d --build
```

تحقق من `/api/ready` على عنوان المناوبة، ثم أنشئ للمشاركين حسابات منفصلة وأدوارًا تماثل أدوارهم في العمل. استخدم بيانات ووسائط مخصصة للتجربة. نفّذ حلقة ونشرة من محطتين على الأقل بالتوازي، وسجّل وقت الإسناد ووقت ظهور التكليف في الحساب المستلم ووقت تأكيده.

| التمرين | الدليل المطلوب |
|---|---|
| تغيير افتتاحية النشرة أثناء التحضير | يطابق الكنترول والمقدم والاستديو ترتيب الفقرات المعتمد وسجل البث التجريبي. |
| فقد الاتصال عند انتقال الكنترول إلى فقرة تالية | تبقى شاشة المقدم على النص الذي وصلها قبل الانقطاع، وتعرض نص الفقرة الحالية عند عودة الاتصال. قارن موضع القراءة وخرج الاستديو على الأجهزة الفعلية. |
| اعتذار ضيف أو تعديل الحجز | أنشئ تكليف متابعة الحلقة باسم المسؤول وموعده. راقب المراجعة من قسم المتابعة، وأعد تأكيد الموعد المعدّل من حجز الاستديو. |
| استبدال مادة | سجّل طلب الوسائط المرتبط بالحَلقة أو النشرة، وراجع حالة الطلب داخل مساحة العمل، وطابق الملف الذي وصل إلى الكنترول. |
| الأرشيف والصلاحيات | جرّب البحث والرابط المباشر بحساب يملك صلاحية الأخبار وآخر حُجبت عنه، وراجع أي قيود إضافية تطبقها المؤسسة. |
| الاستعادة | تحقّق من البصمات واستعد القاعدة والوسائط على بيئة مستقلة، ثم افتح الحلقة وتكليفها والملف وسجّل زمن الاستعادة. |

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
- Local bundles and verified complete bundles in `BACKUP_DIRECTORY` follow `BACKUP_RETENTION`.
  Directory retention starts with bundles carrying this database's origin marker. Keep or retire older and
  incomplete bundles separately. Configure retention and versioning at the provider for `BACKUP_REMOTE`.
- Interrupted staging directories are removed after a failed attempt. Startup also removes abandoned local
  staging and external staging owned by this database after 24 hours. On filesystems that support
  copy-on-write clones, bundles share unchanged disk blocks while remaining independent of the source file.
- When no complete bundle has been delivered, the last delivery is overdue, or the process restarts close
  to the next due time, the scheduler runs within one minute of the due time. It anchors the next run to
  the last complete delivery rather than resetting the clock at every server restart. After a failed
  snapshot or delivery it retries hourly (or sooner for intervals under an hour).
- Downloading a backup file or the database (`/api/v1/db/backups/download`, `/api/v1/db/export`) needs a
  one-time token from `/api/v1/db/confirm-operation` (password, plus the authenticator code when enabled)
  and is written to the audit log (`DB_BACKUP_DOWNLOAD`, `DB_EXPORT`). These files hold every password hash.
- «تصدير بيانات العمل الحالية (JSON)» in the settings is not a backup: it holds only what the browser
  downloaded (no accounts, no uploads, no archived news older than `NEWS_ACTIVE_DAYS`).

### Replit workflow

The `Start application` workflow enables scheduled full backups every 24 hours. Setting
`BACKUP_INTERVAL_HOURS=0` disables them. This workspace currently has no `BACKUP_DIRECTORY` or
`BACKUP_REMOTE` configured, and rclone is not installed, so successful bundles are local to
`DATA_DIR/backups`; this does not protect against loss of the workspace's data volume. For an
independent copy, configure a mounted directory outside `DATA_DIR` or an rclone remote before relying
on these backups for production recovery.

## Recovery Drill

Restore into an isolated environment, never over the live database during verification.
Verify every manifest hash, stop the target server, then restore `newsroom.sqlite` and
`uploads/` together into an empty `DATA_DIR`. Preserve the original live volume first.
Start the same application version and test login, media access and a newsroom workflow.
Record recovery duration and the timestamp of the newest recovered write. A real cloud
delivery and recovery drill are still required before claiming production readiness.

Schema migration 7 builds the Arabic news archive index on first start. Rehearse the
upgrade on an isolated copy and measure the startup time and disk growth for your archive.
After restoring a full bundle, verify archive search, reports and a restored attachment.

## Shutdown And Traffic

On termination, readiness becomes 503, new API requests receive 503 with Retry-After,
and SSE streams close separately. Existing requests may drain until the 10-second deadline.
Long uploads exceeding this deadline can still be interrupted; schedule deployment outside
large uploads or increase the application/container deadlines together.

Health probes bypass traffic quotas. Authenticated quotas are per user; a wider per-IP
limit protects the server before session processing. Configure trusted proxies accurately.
Monitor disk capacity, backup failures, HTTP latency, 429/503 rates and sync errors.

### Local performance baseline

Run `npm exec -- tsx scripts/benchmark-newsroom.ts` on each candidate and save the JSON output
with the candidate commit. The script uses temporary SQLite storage, 50 synthetic accounts in four
stations and 5,000 archived stories. It measures p95 for simultaneous login, bootstrap, writes,
reads by the assigned colleague, and Arabic archive search. It checks that every assignment was
written once and reached its intended user, then reports RSS and event-loop delay.

Use a quiet machine and repeat on the same environment when comparing changes. The fixture exercises
the HTTP API locally. For the production gate, repeat on the deployed database and station network
and record typing responsiveness in the editor, media upload and live broadcast continuity.

## Release Gate

### بوابة الإصدار وحاوية التشغيل

يشغّل `npm run test:e2e` بناء الإنتاج ويفحص كل ملف Playwright على خادم اختبار وقاعدة جديدين. استخدم `npm run test:e2e:work-controls` لفحص واجهة العمل على Chromium وWebKit. يحفظ المشغّل آثار الفشل لكل ملف في `test-results/isolated`. يمكن خفض عدد الخوادم المتزامنة عبر `E2E_FILE_WORKERS=1` على جهاز محدود الموارد.

شغّل **Release candidate** من GitHub Actions، وأدخل وسم المرشح. يتحقق المسار من الـcommit ورقم الإصدار ونجاح CI على `main`. ثم يشغّل اختبارات SQLite وPostgreSQL ومجموعات المتصفح، ويبني صورة الوسم ويتأكد من بقاء بيانات اعتماد المدير بعد استبدال الحاوية مع استخدام وحدة التخزين نفسها. احفظ مع محضر الاعتماد ناتج الفحوص وملف الصورة وبصمته. بعد استيراد الصورة إلى بيئة البروفة استخدم الصورة المعتمدة نفسها في الإنتاج.

مسار المرشح يستطيع بناء حاوية وفحصها على GitHub. لتنفيذ خطوة النشر يجب تحديد نوع الاستضافة وطريقة التحكم بها. يحتوي هذا الدليل على خطوات Compose لنظام Linux يدعم Docker، ويحتاج التشغيل على منصة Node.js مُدارة إلى وسيلة تشغيل وتخزين معتمدة لتلك المنصة.

قبل الاعتماد على Hostinger، اختبر عنوان HTTPS الفعلي وتحقق من أن التطبيق يرى عنوان العميل من الوكيل الموثوق، واستعد نسخة خارجية مع المرفقات إلى بيئة منفصلة، ثم قِس زمن الاستعادة والزمن بين إصدار التكليف ووصوله. نفّذ بروفة نشرة وحلقة من المحطات المستهدفة وسجّل نتيجة التشغيل والتراجع. يحفظ القرار اسم المشرف ونسخة التطبيق وصورة التشغيل وبصمة النسخة الاحتياطية.

تحقّق من قراءة بيانات الإنتاج بدور مُصرَّح له، وبمراسل مكلّف بحلقة واحدة، وبموظف من محطة أخرى لم يتلقّ التكليف. مشاركة البرامج والنشرات بين الأدوار المصرّح لها تظل سياسة غرفة الأخبار المشتركة. يتغير وصول المكلّف إلى المادة المحددة عند إزالة اسمه من التكليف النشط، وتعيد المزامنة تحميل البيانات المتاحة للحساب.

للتشغيل الميداني اختر دور «الخدمات المساندة» لحسابات النقل والدعم وأسند العمل إليها بالاسم. تحقّق من اختفاء المهمة من حساب صاحبها السابق عند إعادة الإسناد، ومن استمرار ظهورها لصاحبها الجديد في الفترة المناسبة. قواعد المهمة على مستوى المؤسسة ومطبقة على الانتقالات الجديدة. يبدأ سجل التنفيذ المعتمد على الحالة عند تسجيل أول بدء؛ السجلات القديمة التي لا تحمل توقيت بدء لا تُستكمل بتوقيت تقديري.

عيّن حساب مشرف مستقل رئيسًا للقسم، ثم افتح «متابعة الفرق والتكاليف» بحسابه. تحقّق من ظهور مهمة موظف وخطوته في تكليف مشترك من «أعمال فريقي»، واستبعاد موظف قسم مستقل أو محطة تقع خارج نطاق القسم. يستطيع رئيس القسم إسناد مهام فريقه وإدارتها من شاشة «المهام». جرّب تغيير رئيس القسم والتحقق من زوال نطاق المتابعة في الطلب التالي. تظل إدارة المهام العامة متاحة لحسابات الإدارة العامة المخوّلة.

CI now runs critical browser workflows in addition to unit tests, type checks, build and
production smoke tests. Run one active application instance and persist `DATA_DIR` with either database engine.

### Database engine selection and switching

The Docker image defaults to PostgreSQL on a fresh data volume. Running via `npm start` defaults to SQLite. An installation with existing data keeps the engine selected in `DATA_DIR`.

For a dedicated host with Docker Compose, copy `.env.example` to `.env`. Generate distinct hexadecimal values with `openssl rand -hex 32` for `MADAR_POSTGRES_PASSWORD` and `MADAR_POSTGRES_ADMIN_PASSWORD`. Configure the HTTPS address, the first administrator or setup token, and the key used to encrypt stored secrets. Then run the production stack.

```sh
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --wait
```

The runtime image uses Node.js 26.13.1 LTS. The second Compose file adds PostgreSQL 19.0 with private networking. Its initialization creates a dedicated application login and a separate administrator. It persists PostgreSQL files in `nrcs-postgres` at `/var/lib/postgresql`. Keep that volume together with `nrcs-data` and the backup location. Bring the stack up with the same Compose project name after updates. Store an independent backup outside the host and follow the recovery rehearsal before switching production.

For a volume initialized by PostgreSQL 18, set `MADAR_POSTGRES_IMAGE=postgres:18.7-trixie` before updating the application. Upgrade the database major version separately once a dump and restore or a `pg_upgrade` rehearsal has succeeded.

For an existing PostgreSQL server, set `POSTGRES_URL` in `.env` and use `docker compose up -d --wait` with the base file. Restrict the supplied login to the application database and give it ownership of the configured schema or permission to create application schemas. `POSTGRES_SCHEMA` defaults to `madar`. For a fresh SQLite deployment, explicitly set `DATABASE_ENGINE=sqlite` and use the base file.

To install a checked image archive, verify its SHA-256 checksum and load it with `docker load -i madar-container.tar.gz`. Set `MADAR_IMAGE=madar-nrcs:<version>` in `.env` to use that image and add `--no-build` to the Compose command. The release-candidate workflow produces the archive and its checksum from the tested tag.

For an existing deployment, configure `POSTGRES_URL` and choose the destination engine in Database Administration or the organization step of the setup wizard. End active broadcasts first. The request schedules the transfer for the next server startup. The existing deployment keeps serving from its current engine until it is stopped and restarted. Run only one instance against the deployment's `DATA_DIR` during the switch.

Startup checks the local upload inventory, copies the authoritative tables to a fresh destination, compares record counts and checksums, and publishes the selection after the transfer succeeds. The original store remains available. A failed transfer leaves it active and shows a failed status in Database Administration. To return to SQLite after new PostgreSQL writes, schedule a reverse transfer from the active PostgreSQL database. The reverse transfer includes those writes.

Keep `DATA_DIR` mounted across restarts. It contains the engine selection, local uploads and backup files. The `.sqlite` backup format remains portable across both engines. The PostgreSQL backup and database export assemble a logical SQLite snapshot. Schedule snapshots of large deployments outside live broadcasts and measure their impact on request latency. PostgreSQL SQL-console previews use a read-only snapshot of operational tables.

Load testing, metrics/alerts, automatic failover and server-side pagination are separate
remaining work; these changes do not promise zero downtime or zero data loss.

### Hostinger VPS مع Coolify وقاعدة PostgreSQL مستقلة

1. اربط مشروع مدار بالمستودع واستخدم `Dockerfile` من الإصدار المعتمد. اضبط منفذ الحاوية الداخلي `3000` ونطاق HTTPS في `APP_URL`، واترك فحص الجاهزية `/api/ready` المضمّن في الصورة. فعّل `COOKIE_SECURE` وحدّد `TRUST_PROXY` وفق عدد الوكلاء الموثوق بهم أو عناوينهم الفعلية. أتح التطبيق عبر وكيل Coolify فقط. [دليل تطبيقات Dockerfile](https://coolify.io/docs/applications/builds/dockerfile)
2. اربط `/data` بوحدة التخزين الحالية للتطبيق واستمر باستخدامها عند استبدال الحاوية. جهّز `/backups` واضبط `BACKUP_DIRECTORY=/backups` عند استخدامه. لحاوية بجذر للقراءة فقط، اترك هاتين الوجهتين قابلتين للكتابة لحساب `node` واستخدم `tmpfs` لـ`/tmp`. احتفظ بنسخة كاملة خارج الخادم تشمل المرفقات. [دليل التخزين الدائم](https://coolify.io/docs/applications/configuration/persistent-storage)
3. شغّل PostgreSQL على شبكة الوجهة نفسها مع إبقاء الوصول العام مغلقًا. في التثبيت الجديد شغّل `postgres:19.0-trixie` بوحدة دائمة عند `/var/lib/postgresql`. جهّز قاعدة مخصّصة وحساب تشغيل غير فائق الصلاحية، وفعّل `pg_trgm` في قاعدة مدار باستخدام حساب الإدارة. يمكن مراجعة [نمط التهيئة في المشروع](../docker/postgres/10-madar.sh) عند إنشاء مورد جديد. اضبط `POSTGRES_URL` في إعدادات التشغيل السرية باستخدام المضيف الداخلي وبيانات حساب التطبيق. [دليل PostgreSQL في Coolify](https://coolify.io/docs/databases/postgresql)
4. عند نقل تثبيت قائم من SQLite، أنهِ جلسات البث النشطة وخذ نسخة كاملة قبل الانتقال. افتح «إدارة قاعدة البيانات» واختر PostgreSQL، ثم أعد تشغيل حاوية التطبيق بعد جدولة النقل. يظل ملف SQLite الأصلي داخل `/data` ويحدد التطبيق القاعدة النشطة بعد التحقق من النقل. عند التثبيت الجديد يكفي اتصال `POSTGRES_URL` لبدء استخدام PostgreSQL عبر الإعداد الافتراضي للصورة.
5. تحقّق من نجاح `/api/ready` وتطابق إصدار `/api/health`. راجع نجاح النقل والمحرك النشط في «إدارة قاعدة البيانات»، ثم سجّل الدخول بحساب موجود وافتح مرفقًا محفوظًا وابحث عن خبر عربي مؤرشف. افحص أن حساب التطبيق يظهر `rolsuper=false` وأن فهرس `idx_news_archive_terms` موجود في المخطط النشط. احفظ الدليل دون رابط الاتصال أو كلمة المرور.

## In-app Updates

### Prepare a release

`package.json` is the single source for the running server, backup rehearsal and browser version.
Use the release command to update the package manifest, lockfile, first «ما الجديد» version and
latest-release link in the README together:

```sh
npm run release:version -- 4.6.0
```

Replace `4.6.0` with the intended `major.minor.patch` version. Then:

1. Update the date, title and change list in the first «ما الجديد» entry, and add
   `docs/releases/<version>.md` with the release details. The command only updates its version.
2. Run `npm run check` (TypeScript checks, all tests and the production build).
3. Confirm the release-version test passes and the first «ما الجديد» entry describes this release.
   It reports the file and value when package metadata or release notes do not match.
4. Review the changes and follow the normal release and deployment process separately.

Open «ما الجديد» and select «فحص الإصدارات» to compare the browser build, the server build
and the latest stable GitHub release. Once the server is running a newer build, select
«تحميل الواجهة الجديدة» after pending writes have synced.

- `UPDATE_MODE=manual` is the default. Publish the build with the existing deployment process.
  If GitHub requires authentication to list releases, configure a repository-scoped
  `UPDATE_GITHUB_TOKEN` with Contents read on the server.
- `UPDATE_MODE=github` enables dispatch to the configured `UPDATE_GITHUB_WORKFLOW` in this
  repository. Configure `workflow_dispatch` on `main` with a required string input named
  `version`, and use a server token with Actions write and Contents read. The pipeline checks out
  the exact release tag supplied in `version`, uses a protected environment and serializes deployments.
- `UPDATE_MODE=webhook` delegates deployment to an operator-managed HTTPS endpoint such as a
  Docker Compose release service. Set `UPDATE_WEBHOOK_URL` and `UPDATE_WEBHOOK_SECRET` with at
  least 32 characters. The POST JSON contains `version` and `repository`. Validate
  `X-Madar-Signature` against HMAC-SHA256 of `X-Madar-Timestamp + "." + raw request body` using
  the shared secret and a constant-time comparison. Accept recent requests only and deduplicate
  using `Idempotency-Key`. Return a 2xx after placing the exact release tag in the queue.

Only system-settings managers can request deployment. Accepting a request records the dispatch,
while the running version confirms deployment after the external system finishes. The external
system owns backup, maintenance timing, stopping the server and validating readiness after start.
For an automated update in production, Madar requires evidence of a complete, verified backup
delivered to the configured external destination within the last 24 hours. Configure
`BACKUP_DIRECTORY` or `BACKUP_REMOTE` and run a full backup before requesting deployment.
The existing environment and storage configuration remain part of the deployment workflow.
For a manual update from a Git checkout, run `git pull --ff-only`, then rebuild and restart with
the same environment, `DATA_DIR` and storage mounts. Keep a custom `DATA_DIR` outside the checkout
so replacing or cleaning that checkout leaves its data in place.

When an established SQLite database needs a schema upgrade, startup saves a local
`_premigration.sqlite` snapshot in `DATA_DIR/backups` before applying the pending migrations in
one transaction. A failed snapshot or migration stops startup with the original schema and
records intact. This snapshot covers the database. Continue taking the full backup described
above to protect the uploads as well.

Before replacing the app, verify a full backup (SQLite and uploads) stored outside the running
container, preserve the deployment environment and secrets, and keep the same `DATA_DIR` backed
by the same durable storage. For Compose, build the exact release from a clean checkout and keep
the existing data and backup volumes. Keep the Compose project name stable, and avoid `down -v`.
After replacement, verify `/api/ready` and the version at `/api/health`, then sign in to check an
existing record, an attachment and a saved setting. Pause deployment if an on-air session starts
after the initial in-app check.

Cloud Run's writable container filesystem is temporary. Verify the deployment's storage setup
before replacing any revision. SQLite runs in WAL mode and requires a local filesystem shared by
connections on one host. Cloud Run's NFS mount does not support file locking. Keep this SQLite
deployment on a single host with durable local storage if the Cloud Run environment only provides
temporary storage or network mounts. Preserve a full backup outside the service before moving any
existing installation.

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
- **Browser setup on a fresh database.** Set `SEED_DEMO_DATA=false`, leave `ADMIN_PASSWORD` empty, and
  set `INSTALL_SETUP_TOKEN` to a private value generated with `openssl rand -hex 32` before the first
  start. In the HTTPS sign-in page, choose **بدء إعداد النظام** and enter the token to create the first
  administrator with their own password. Remove the token from the environment afterwards.
- **Temporary passwords.** While an account must change its password, the server answers every API
  call except `/auth/me`, `/auth/logout` and `/auth/change-password` with 403
  `PASSWORD_CHANGE_REQUIRED`. Temporary passwords issued by an administrator expire after
  `TEMP_PASSWORD_HOURS` (72). Each person keeps at most 10 signed-in devices.
- **Session lifetime.** Regular sign-in uses a browser-session cookie and a server expiration
  of `SESSION_TTL_HOURS`. The optional «تذكّرني على هذا الجهاز» checkbox keeps a persistent
  cookie for `REMEMBER_SESSION_DAYS` (14 by default, maximum 30). Logout revokes either session.
- **Health.** `/api/health` shows `dbId`/`instance` to signed-in users only; use `/api/ready` for probes.
- **Audit trail.** Only the server writes audit entries (accounts, roles, permission exceptions,
  suspensions, stations, departments, settings, backups and downloads); browsers cannot add rows.
- **rclone.** The stock image has no rclone; `BACKUP_REMOTE` needs an image that adds it.
