# خطة الصقل الشامل وإعادة الهندسة لنظام «مدار» (Madar v5.0 Polish Roadmap)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` per wave if further task-level granularity is needed, and `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement each wave task-by-task.

**Goal:** صقل نظام «مدار» في جميع جوانبه (نموذج البيانات، قاعدة البيانات SQLite/PostgreSQL، تسريع الأداء والمزامنة، الواجهة وتجربة الاستخدام UI/UX، وضمان الجودة والأمان QA) وإزالة التراكمات والشقوق غير المرئية الناتجة عن التطوير عبر 16+ مرحلة متعاقبة.

**Architecture:** الحفاظ على معمارية الخادم كمصدر وحيد للحقيقة مع نسخة متزامنة في المتصفح، مع تنظيف جذري للحقول المزدوجة الموروثة، وترقية مخطط القاعدة بأعمدة مفهرسة و`JSONB`/`pg_trgm` وقراءات غير حاجبة في PostgreSQL، وإلغاء النسخ العميق وإعادة الرسم الشاملة في الواجهة، وتوحيد أنماط النماذج والحفظ والمسودات وفق دستور `DESIGN.md`.

**Tech Stack:** TypeScript 7, React 19, Vite 8, Tailwind CSS 4, Express 5, SQLite (`better-sqlite3` + FTS5), PostgreSQL (`pg` + `JSONB` + `pg_trgm`), Vitest 5, Playwright.

---

## موجات التنفيذ المستقلة (Execution Waves)

### الموجة 0: تطهير النطاق وسد الثغرات الأمنية وبقايا المراحل الأولى
- [ ] **0.1 سد ثغرة تجاوز قيد نطاق العمل المسند (`A1`):** حماية الانتقالات غير المباشرة لـ `assignedWorkOnly` (تغيير `departmentId`، `parentId`، الدور، وحذف الحقل النصي الموروث `department`) في `src/server/permissionChanges.ts` و`src/server/policy.ts`.
- [ ] **0.2 توحيد حقول وحالات المهام:** إزالة `assignedToId`/`assignedToName` لصالح `assigneeId`/`assigneeName` (إصلاح خلل `src/shared/editorialQueue.ts`)، وإلغاء `DONE` لصالح `COMPLETED` مع مصدر واحد لـ `normalizeTaskStatus` في `src/shared/taskWorkflow.ts` وترحيل البيانات المخزنة.
- [ ] **0.3 توحيد حقول الوسائط والفيديو والمجموعات الميتة:** توحيد `fileUrl` إلى `url` في `MediaAsset`، وتوحيد `videoUrl` إلى `videos[]` في `NewsItem`، وحذف مجموعة `breaking` غير المستخدمة من `src/shared/collections.ts`.
- [ ] **0.4 إزالة الحالة العامة القابلة للتلوث وبقايا المرحلة الأولى:** تحويل `applyDepartmentSettings` و`rememberStationSettings` من متغيرات وحدة عامة إلى سياق مرتبط بنسخة القاعدة، وحذف المؤقتات الدورية وتنظيف `localStorage` الميت في `src/services/selfHealingService.ts`، ونقل `mockData.ts` وملفات البذر إلى `src/server/seeds/` مع فصل `INITIAL_SETTINGS` في `src/shared/settings.ts`.

### الموجة 1: إعادة صقل قاعدة البيانات ومحركي SQLite وPostgreSQL
- [ ] **1.1 توحيد نموذج الحذف والأعمدة المفهرسة:** توحيد ازدواجية `deleted` و`data.deletedAt` عبر عمود `deleted_at` متسق، وإضافة أعمدة/فهارس تعبيرية للحقول الساخنة (`status`, `stationId`, `assigneeId`, `resourceId`).
- [ ] **1.2 استعلامات تعارض الحجوزات والأسماء المرجعية بلا مسح ذاكرة:** استبدال مسح `this.listData('bookings')` باستعلام فهرس زمني مباشر، وإلغاء حلقات إعادة كتابة آلاف الأخبار/البرقيات/البرامج عند إعادة تسمية تصنيف أو مصدر أو نوع برنامج في `src/server/sync.ts`.
- [ ] **1.3 ترقية PostgreSQL للتكافؤ والأداء العالي:** تحويل عمود البيانات إلى `JSONB` في `src/server/postgres/schema.ts`، وإضافة فهرس `pg_trgm` لجدول `news_archive_index`، وفصل مسارات القراءة الثقيلة عبر مجمع اتصالات قراءة غير حاجب بدل انتظار `Atomics.wait` الأحادي.
- [ ] **1.4 بصمات نزاهة حزم النسخ الاحتياطي:** إضافة بيان SHA-256 موثق يربط نسخة القاعدة بمجلد `uploads` مع فحص استعادة معزول شامل.

### الموجة 2: تسريع الأداء والمزامنة وتخفيف استهلاك الذاكرة
- [ ] **2.1 توسيع التحميل المتدرج (`PAGED_BOOTSTRAP_COLLECTIONS`):** إضافة `productionCards`, `requests`, `media`, `bulletins`, `bulletinStories`, `bookings`, `diary` للتحميل الصفحي بالمؤشر.
- [ ] **2.2 قراءات `O(1)` في `DataStore` واشتراكات انتقائية في React:** استبدال `JSON.parse(JSON.stringify)` في `DataStore.get` بلقطات غير قابلة للتعديل ومشاركة هيكلية، واستبدال إعادة الرسم الجذرية في `src/App.tsx` بخطاف `useCollection` مبني على `useSyncExternalStore`.
- [ ] **2.3 تهدئة عاصفة SSE وتقسيم الحزم:** تجميع نبضات `changeBus` ضمن نافذة زمنية قصيرة مع تمرير أسماء المجموعات المتغيرة، وفصل الحزم الثقيلة (`docx`, `jszip`, `qrcode`) في `vite.config.ts`.

### الموجة 3: تفكيك الملفات العملاقة وتوحيد معمارية الكود
- [ ] **3.1 تقسيم طبقة العميل (`api.ts` و`App.tsx`):** تفكيك `src/services/api.ts` (2,649 سطراً) إلى خدمات نطاقية مركزة، وتبسيط `src/App.tsx` (1,390 سطراً) عبر استخراج منسقات المسارات والأوامر.
- [ ] **3.2 تقسيم طبقة الخادم (`app.ts` و`sync.ts`):** تفكيك المسارات في `src/server/app.ts` ومعالجات المجموعات في `src/server/sync.ts` إلى وحدات مستقلة لكل نطاق عمل.
- [ ] **3.3 تفكيك الشاشات الضخمة:** تقسيم `NewsEditorView.tsx` (2,346 سطراً) و`SettingsView.tsx` (1,799 سطراً) و`NewsListView.tsx` (1,251 سطراً) إلى مكونات فرعية وخطافات منطق معزولة.

### الموجة 4: صقل UI/UX والاتساق البصري وتجربة الجوال
- [ ] **4.1 توحيد النماذج والحفظ والمسودات:** تحويل نماذج الإنشاء/التعديل الرئيسية المتبقية في `Modal` (`ProgramsView`, `GuestsView`, `EpisodesView`, `MediaLibraryView`) إلى `FormPage`، وتعميم حارس التعديلات غير المحفوظة ومسودات الاستعادة، وتوحيد تغذية الحفظ الراجعة (`confirmSaved`) في كل الإجراءات.
- [ ] **4.2 تدقيق الالتزام بدستور `DESIGN.md` والجوال:** إزالة أي أزرار داكنة مخالفة على الأسطح الورقية، ضبط `tabular-nums` والجمع العربي والحالات الفارغة، صقل شاشات الجوال (360–430px) وخاصة شجرة الصلاحيات والجداول الكثيفة، ونقل `TestingView` إلى أدوات مراقبة مدير النظام.

### الموجة 5: بوابات الجودة (QA) واختبارات الضغط والتوثيق
- [ ] **5.1 استقرار الاختبارات ومصفوفة القاعدتين:** إصلاح `ECONNRESET` المتقطع في اختبارات الرفع، وتشغيل الاختبارات كاملة على SQLite وPostgreSQL دون تخطٍّ (`0 skipped`).
- [ ] **5.2 تشظية Playwright وبوابة الأداء الآلية:** تقسيم اختبارات المتصفح الـ 95+ إلى شرائح متوازية سريعة، وإضافة اختبار ضغط آلي لـ 50 مستخدماً متزامناً يتحقق من ميزانية الأداء (p95) وأحجام الحزم.
- [ ] **5.3 توحيد الإصدار وتحديث التوثيق:** ربط إصدار `package.json` و`whatsNew.ts` بمصدر واحد، وتحديث `ARCHITECTURE.md` و`tasks.md` و`docs/USER_GUIDE.md`.
