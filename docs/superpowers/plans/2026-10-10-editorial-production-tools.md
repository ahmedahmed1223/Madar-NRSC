# Editorial Production Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver reliable guest follow-up, written pronunciation references and an immutable correction register without changing live broadcast copy automatically.

**Architecture:** Implement three independently testable slices on the current feature branch. Extend existing episode guests; add bounded dictionary entities through existing synchronization; create corrections through a server-owned idempotent endpoint. Existing teleprompter and offline packet readers consume reference notes only.

**Tech Stack:** React/TypeScript, Express, SQLite entities, Zod, Vitest and Playwright; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-editorial-production-tools-design.md`

## Global Constraints

- Preserve production data, current edit locks, permission boundaries and confirmed-save behavior.
- Guest notes at most 1000 characters; missing technical status means NOT_REQUIRED and does not block existing shows.
- Dictionary limits: 2000 active entries, term 1-200, pronunciation 1-300, note 0-1000 characters.
- Offline notes: optional field on version-1 packets, at most 200 entries; legacy missing field reads as empty.
- Correction reason 1-2000 and summary 1-1000 characters. Actor, timestamp and target version are server-controlled; generic client writes are forbidden.
- Never automatically change script bytes, approval state, timing, speed or broadcast commands.
- No integration, push, release bump or destructive live-data tests within this plan.
- Use existing components and themes, 390px/1440px, light/dark, RTL, keyboard and 44px command targets.

## Review Focus

1. Inactive/deleted users assigned to an existing guest must remain readable without becoming assignable to new guests; Task 1 tests this.
2. Short dictionary terms occurring inside unrelated words must not flood the presenter panel; Task 3 tests word boundaries and capped results.
3. Old encrypted offline packets must reopen without the new field or a network; Task 3 tests old packet parsing and browser reopen.
4. Permission revocation or entity changes between loading a correction form and submitting must not create an unauthorized/stale record; Task 4 tests fresh authorization and version checks.
5. Linked materials without a responsible user, or a responsible user lacking access, must not broadcast correction details to every account; Task 4 tests recipient selection.

## Task 1: Guest Follow-Up

**Files:** modify `src/types/index.ts`, `src/shared/episodePlan.ts`, `src/shared/production.ts`, `src/server/policy.ts`, `src/components/episodes/EpisodeGuestsPanel.tsx`; create `src/shared/guestFollowUp.ts`, `tests/server/guestFollowUp.test.ts`, `tests/e2e/guest-follow-up.spec.ts`.

**Interfaces:** export `technicalCheckStatuses` and `guestFollowUpError(guest: unknown, users: User[], previous?: EpisodeGuest): string | null`. Extend EpisodeGuest with contactOwnerId, technicalCheckAt, technicalCheckStatus and technicalCheckNote. Existing `onSaveEpisode` becomes `boolean | Promise<boolean>` in the guest panel, matching its parent.

- [ ] Write failing validation tests: status defaults to NOT_REQUIRED; 1000-character note passes and 1001 fails; invalid UTC time or unknown enum fails; active owner passes; new inactive owner fails; unchanged historical inactive owner passes. Test an unauthorized source update, episode conflict/lock and unchanged broadcast blockers.
- [ ] Run `npm test -- tests/server/guestFollowUp.test.ts`; expect missing helper/new validation assertions to fail.
- [ ] Implement validation in `guestFollowUp.ts`, call it from existing episode policy with current users and prior guests. Add bounded fields without a database schema migration. Readiness exposes follow-up warnings separately from blockers.
- [ ] Add labeled owner/time/status/note controls to the existing guest panel. Store field drafts by guest key. Await `onSaveEpisode`; clear only successfully saved drafts, show inline rejection and retry, guard duplicate calls synchronously. Preserve pending contact log notes on failed saving. Display timezone and immutable legacy booking behavior.
- [ ] Run server tests and build, then `npm run test:e2e -- tests/e2e/guest-follow-up.spec.ts`; assert field preservation after mocked conflict, successful retry, owner selection, keyboard and mobile overflow.
- [ ] Commit the guest slice with its tests.

## Task 2: Dictionary Storage and Management

**Files:** create `src/shared/pronunciation.ts`, `src/components/settings/PronunciationSettings.tsx`, `tests/server/pronunciation.test.ts`, `tests/e2e/pronunciation.spec.ts`; modify `src/shared/collections.ts`, `src/types/index.ts`, `src/server/policy.ts`, `src/server/sync.ts`, `src/services/api.ts`, `src/views/SettingsView.tsx`.

**Interfaces:** `PronunciationTerm { id, term, pronunciation, note, enabled, createdBy, createdAt, updatedBy, updatedAt }`; `PronunciationNote = Pick<PronunciationTerm, 'term' | 'pronunciation' | 'note'>`; `pronunciationError(value: unknown): string | null`. Register `pronunciationTerms` with storage key `madar_pronunciation_terms_v1`. ApiService provides `getPronunciationTerms(): PronunciationTerm[]`, `savePronunciationTerm(value: Partial<PronunciationTerm>): Promise<PronunciationTerm>` and `deletePronunciationTerm(id: string): Promise<void>` using existing confirmed writes.

- [ ] Write failing server tests for all exact size limits, 2000-active-entry cap, disabled terms, duplicate normalized terms, system.settings writes, authorized reader access and rejection of forged audit metadata/concurrent updates. Assert `normalizeArabic('أحمد') === normalizeArabic('احمد')` duplicates are rejected.
- [ ] Run `npm test -- tests/server/pronunciation.test.ts`; expect missing registration/validation assertions to fail.
- [ ] Add collection/policy/sync metadata stamping using existing patterns. For duplicates, compare the active normalized term against other non-deleted enabled entries, excluding the same id; enforce cap on create/enable transitions. Do not permit caller-controlled actor/time.
- [ ] Add searchable dictionary management inside editorial settings with add/edit/delete confirmation and enabled toggle. Await server confirmation, retain draft on conflict and restore focus on close. Display historical metadata read-only.
- [ ] Run server tests, build and dictionary browser tests for denied edits, duplicate error, retry, search and both viewport sizes.
- [ ] Commit the dictionary management slice.

## Task 3: Pronunciation in Editors, Teleprompter and Offline Air

**Files:** create `src/components/rundown/PronunciationPanel.tsx`, `tests/pronunciationMatching.test.ts`; modify `src/shared/pronunciation.ts`, `src/components/rundown/TeleprompterModal.tsx`, `src/views/NewsEditorView.tsx`, `src/views/EpisodeWorkspaceView.tsx`, `src/shared/offlineAir.ts`, `src/server/offlineAir.ts`, `src/offlineAir/OfflineAirApp.tsx`, existing offline packet/store tests and `tests/e2e/pronunciation.spec.ts`.

**Interfaces:** `matchingPronunciations(script: string, terms: PronunciationTerm[], limit = 200): PronunciationNote[]`. Add `pronunciationNotes` as a bounded optional offline packet array; readers use `packet.pronunciationNotes ?? []`. PronunciationPanel accepts `{ notes: PronunciationNote[], preparedAt?: string }` and never mutates a script.

- [ ] Write failing matching tests: Arabic variants and punctuation match, embedded substrings do not match standalone terms, disabled terms are excluded, repeated terms return one note and more than 200 matches truncate deterministically. Assert input script bytes stay unchanged.
- [ ] Write failing offline tests for omitted field, valid 200 notes, 201 rejection and excessive text fields. Assert existing proof verification and draft reconciliation still work for old packets; pronunciation data cannot authorize a server operation or enter script-import payloads.
- [ ] Implement token-boundary normalized matching in `pronunciation.ts`, using Unicode letters/numbers rather than ASCII-only word boundaries. Display short matches as reference suggestions rather than automatic replacements.
- [ ] Add searchable reference panel in editors and a collapsible non-overlapping panel in teleprompter controls. Keep scroll viewport dimensions stable; opening the panel must not change scroll position, speed, current paragraph or script. Snapshot relevant terms during server preparation; encrypt them through existing packet storage. Offline reads require no API request and show preparation time.
- [ ] Run matching and offline tests; build and run dictionary/teleprompter browser journey. Assert opening/closing preserves speed/position, Arabic text stays readable on 390px/1440px, and an old packet reopens offline.
- [ ] Commit the pronunciation reference/offline slice.

## Task 4: Immutable Correction Register and Notifications

**Files:** create `src/shared/newsCorrections.ts`, `src/server/newsCorrections.ts`, `tests/server/newsCorrections.test.ts`; modify `src/shared/collections.ts`, `src/types/index.ts`, `src/server/policy.ts`, `src/server/app.ts`, `src/server/notifications.ts`, `src/services/api.ts`.

**Interfaces:** `NewsCorrection { id, newsId, newsVersion, reason, summary, actorId, actorName, createdAt, relatedCorrectionId? }`; `CreateCorrectionInput { newsId, expectedVersion, reason, summary, requestId, relatedCorrectionId? }`. Register read-only `newsCorrections` under `madar_news_corrections_v1`. Server `createNewsCorrection(db: NewsroomDatabase, auth: AuthContext, input: CreateCorrectionInput): NewsCorrection`; POST `/api/v1/news/:id/corrections`; client `registerNewsCorrection(input: CreateCorrectionInput): Promise<NewsCorrection>`.

- [ ] Write failing endpoint tests for CSRF/auth, news.review/news.edit_any, revoked permissions, inaccessible/deleted news, stale expectedVersion, exact field limits, forged actor/time and generic sync create/update/delete rejection.
- [ ] Add failing idempotency tests: same actor/requestId/payload returns same record without new alerts; changed payload with the same key conflicts. Test linked episode/bulletin recipients: active responsible users with target access only, missing owner sends nobody, duplicates collapse, preferences remain respected.
- [ ] Run `npm test -- tests/server/newsCorrections.test.ts`; expect missing endpoint/service to fail.
- [ ] Implement server-side fresh news/version/authorization checks. Derive deterministic id from actor/requestId; compare existing payload before returning a replay. Validate optional linked correction belongs to the same news. Transactionally create correction, audit and deduplicated authorized bell notifications using existing delivery categories. Response includes no inaccessible related script. Emit change revision after commit.
- [ ] Add canRead filtering for corrections through their referenced news. Existing history is the full-text source; never duplicate script into correction records or change news status/text. Use server timestamp, actor and current row version only.
- [ ] Run server tests and existing news workflow/notifications tests; commit correction service slice.

## Task 5: Correction Workflow and Linked Badges

**Files:** create `src/components/editor/NewsCorrectionsPanel.tsx`, `tests/e2e/news-corrections.spec.ts`; modify `src/views/NewsEditorView.tsx`, `src/components/rundown/RundownTable.tsx`, `src/views/BulletinRundownView.tsx`, `src/content/help.ts`.

**Interfaces:** NewsCorrectionsPanel receives newsId/current version/current user and uses Task 4's registerNewsCorrection. Linked badges derive records by existing `newsId`, not title matching. The form generates one requestId per payload attempt and preserves it for network retry; changed payload gets a new id.

- [ ] Write failing browser tests for creation after confirmed editing, immutable chronological display, correction reason preservation on version conflict, explicit refresh/review before retry, permission-limited controls and linked navigation without script replacement.
- [ ] Implement current-version correction form, note-to-prior-correction linkage, required reason and summary, synchronous submit guard and inline error. On conflict retain input but require explicit review of the fresh version before enabling retry. Do not claim that recording a correction has changed the broadcast copy.
- [ ] Add correction badges and permitted links in linked materials. Show unavailable history explicitly when retention removed the version; never fabricate a diff. Notification navigation opens only the authorized news/record.
- [ ] Add help for guest follow-up, reference pronunciation, offline preparation snapshot, correction vs text editing and intentional non-automatic propagation.
- [ ] Build and run correction browser tests on both viewports/themes with keyboard focus/axe/overflow. Verify unrelated readers receive no content through a badge or notification.
- [ ] Commit correction UI/help slice.

## Task 6: Final Verification and Review

- [ ] Run `npm run check` with Git's OpenSSL directory on PATH on Windows; expect TypeScript, all unit/server tests and build to pass.
- [ ] Run one serial Playwright invocation with new feature journeys plus existing guest/editor/teleprompter/offline/smoke regressions. Tests use isolated data only; no concurrent browser runner or rebuild during a run.
- [ ] Inspect a bounded mobile/desktop light/dark screenshot batch and accessibility results. Correct reproduced functional findings with RED/GREEN coverage; avoid unrelated refactors.
- [ ] Perform the executing-plans whole-branch review and its single verified fix pass. Record decisions and any deferred findings in the release draft, then clean only this plan's scratch directory.
- [ ] Rebuild to remove the offline test helper from dist, restart local preview with demo seeding disabled, and verify health/readiness/database identity.
- [ ] Report feature outcomes, tests and limits. Wait for explicit integration/release instructions before merge or push.
