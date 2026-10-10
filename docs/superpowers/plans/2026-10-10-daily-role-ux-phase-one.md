# Daily Role UX Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve personal work queues, private saved news filters and safe list-context restoration without widening access or changing editorial/broadcast state.

**Architecture:** Extend MyWorkPanel and NewsListView. Typed shared validators define private filter records; server policy and sync enforce ownership and confirmed versioned writes. Local context contains only bounded navigation metadata.

**Tech Stack:** Existing React/TypeScript, Tailwind, lucide-react, Express, SQLite collection sync, Vitest and Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-daily-role-ux-design.md` (phase one only; later phases remain required roadmap deliverables).

## Global Constraints

- Existing Arabic RTL UI, keyboard conventions, draft protection, and offline-air behavior remain intact.
- Server RBAC is authoritative. Default role names do not define access for customized roles.
- Names are trimmed, nonempty, at most 80 characters. Limit each user to 30 saved filters. Search text is at most 200 characters.
- No executable queries, arbitrary URLs, script, or embedded content.
- An optimistic local result is not a successful save until acknowledged.
- Never reopen a modal, replay an action, auto-submit a draft, or restore playback.
- No release bump or merge until the complete approved roadmap has passed its required verification; this phase must not be presented as the complete goal.
- Preserve live database identity and data. Browser writes use isolated test data.

## Review Focus

- Private records in bootstrap, changes, conflict payloads and generic sync: another account must never receive the record (Task 2).
- Station midnight while the device timezone differs, invalid zone, daylight-saving transitions: stable day classification (Task 4).
- Existing list context versus explicit initial tab, missing references and shrinking results: no stale filter or page silently broadens the view (Task 3).
- Account switching or blocked browser storage: no cross-account restoration; current visit remains usable (Task 3).
- Slow or disconnected save followed by retry or concurrent edit: no false success, duplicate filter or stale overwrite (Tasks 2 and 5).

## File Boundaries

| File | Responsibility |
| --- | --- |
| src/shared/savedNewsFilters.ts | Typed definition, strict filter/name validation |
| src/shared/workContext.ts | Versioned bounded local navigation metadata and section preferences |
| src/shared/myWork.ts | Pure station-day/window and personal section ordering helpers |
| src/shared/collections.ts | Register private savedNewsFilters collection |
| src/server/policy.ts, src/server/sync.ts | Private read/write enforcement, timestamps, limit and safe conflicts |
| src/services/api.ts | Confirmed filter mutation wrapper using existing sync API |
| src/hooks/useWorkContext.ts | User-keyed context persistence and storage-failure feedback |
| src/components/news/SavedNewsFilters.tsx | Accessible picker and management dialogs |
| src/views/NewsListView.tsx | Apply filter definitions and preserve list anchor |
| src/components/dashboard/MyWorkPanel.tsx | Section preferences and exact target navigation |
| src/views/DashboardView.tsx | Consistent queue reference time/settings integration |
| src/App.tsx, src/services/router.ts | Existing navigation integration only where target focus is needed |
| src/views/HelpView.tsx | Arabic documentation of actual delivered features |

Inspect actual router and confirmed-write signatures before edits; keep their existing public contracts and adapt at the feature boundary, rather than rename them globally.

### Task 1: Define Validated Filter and Context Models

**Files:** Create `src/shared/savedNewsFilters.ts`, `src/shared/workContext.ts`; test `tests/savedNewsFilters.test.ts`, `tests/workContext.test.ts`.

**Interfaces:** Export `SavedNewsFilterDefinition` with activeTab, searchQuery, selectedCategory, selectedPriority, onlyMine, authorId, fromDate, toDate; `SavedNewsFilter` with server-owned metadata from spec. Export `savedNewsFilterError(value: unknown): string | null`, `sanitizeWorkContext(value: unknown): WorkContext`, and `sanitizeWorkSections(value: unknown): WorkSectionPreferences`. IDs are bounded strings using the repository ID convention; selectedCategory preserves the existing category-name semantics (bounded to 128 characters, no markup/control characters); status/priority/date values are allowlisted. WorkContext has schemaVersion 1, definition, page and optional anchorId, never article data. Section keys are exactly the existing MyWorkPanel section identifiers.

- [ ] Write tests: `accepts_supported_filter`, `rejects_unknown_fields_and_oversized_name`, `rejects_unsupported_status_priority_dates`, `bounds_context_and_excludes_content`, `deduplicates_section_order_and_defaults_new_sections`. Assert 80/200 limits, unknown schema fallback, bounded nonnegative page and no arbitrary fields.
- [ ] Run `npm test -- tests/savedNewsFilters.test.ts tests/workContext.test.ts`; confirm the tests fail for absent implementation.
- [ ] Implement the interfaces with strict validation and existing status/priority definitions. Preserve existing news-list page-size/column model unchanged.
- [ ] Run the same tests; require all pass.
- [ ] Commit the shared models and tests.

### Task 2: Enforce Private Versioned Filter Persistence

**Files:** Modify `src/shared/collections.ts`, `src/server/policy.ts`, `src/server/sync.ts`, `src/services/api.ts`; test `tests/server/savedNewsFilters.test.ts`.

**Interfaces:** Register `savedNewsFilters`. API feature methods create/update/delete accept a typed filter payload and captured base version; return the existing confirmed-operation result. Do not invent a second offline mutation queue. Ownership comes from auth.user.id; createdAt is immutable, updatedAt is server time. Read restrictions cover bootstrap/poll/SSE and conflict responses.

- [ ] Write server tests: `private_bootstrap_and_changes`, `rejects_foreign_mutation_without_current_payload`, `stamps_authenticated_owner_and_time`, `enforces_30_active_filters`, `rejects_invalid_definition`, `stale_update_and_delete_conflict`, `retry_does_not_duplicate`. Include an admin account, forged owner, guessed ID, tombstone and generic-sync entry points. Use existing test DB/auth helpers.
- [ ] Run `npm test -- tests/server/savedNewsFilters.test.ts`; verify RED.
- [ ] Implement collection registration, policy, stamping, per-owner count inside the write transaction, and API confirmed wrappers. Reject private unauthorized operations before attaching current data to a response.
- [ ] Run the server test plus `tests/server/api.test.ts` and `tests/client/recovery.test.ts`; require GREEN.
- [ ] Commit private persistence.

### Task 3: Safely Restore and Apply News List Context

**Files:** Create `src/hooks/useWorkContext.ts`; modify `src/views/NewsListView.tsx`; test `tests/workContext.test.ts`, `tests/e2e/daily-work-context.spec.ts`.

**Interfaces:** `useWorkContext(userId: string, scope: string)` returns sanitized context plus save/clear operations. Keep the existing `nrcs_news_context` per-user/per-initial-tab namespace and migrate its bounded metadata to schema 1. Preserve `nrcs-news-list-preferences` untouched. Explicit initialTab partitions remain separate. Anchor restoration waits until authorized results load, runs once per return, and clamps page to the available result count.

- [ ] Write tests for malformed storage, account switch, storage refusal, deleted anchor, empty results, explicit breaking tab, shrinking pages and unavailable category/author references. Assert no body/attachment storage and no restoration of selected bulk IDs or dialogs.
- [ ] Run `npm test -- tests/workContext.test.ts` and `npx playwright test tests/e2e/daily-work-context.spec.ts --workers=1`; confirm RED on the new behavior using isolated server data.
- [ ] Implement hook and bounded migration; replace ad hoc JSON context reads in the touched view. Persist the clicked item ID before navigation. Show an unavailable reference chip with removal rather than substituting ALL.
- [ ] Run those tests and existing `tests/e2e/news-ux.spec.ts`; require GREEN.
- [ ] Commit context restoration.

### Task 4: Improve My Work Without Duplicating Queues

**Files:** Create `src/shared/myWork.ts`; modify `src/components/dashboard/MyWorkPanel.tsx`, `src/views/DashboardView.tsx`, and existing entity navigation integration; test `tests/myWork.test.ts`, `tests/e2e/daily-work-roles.spec.ts`.

**Interfaces:** `stationWorkDay(now: Date, timezone: string | undefined): string` uses validZone and a Gregorian ISO day, independent of display calendar/device timezone when station zone is valid; invalid zone uses existing device fallback. `orderWorkSections(keys: string[], preferences: WorkSectionPreferences): string[]` preserves mandatory operational warnings. Use one now value per queue update. Keep current news-review order until stage two.

- [ ] Write pure tests for station midnight, DST, invalid zone and stable ordering. Write browser cases for customized permissions, empty queues, local section preferences, exact news/episode/bulletin-story actions, and inaccessible/deleted targets. Existing general-list destinations must focus a validated item rather than manufacture unsupported routes.
- [ ] Run `npm test -- tests/myWork.test.ts` and `npx playwright test tests/e2e/daily-work-roles.spec.ts --workers=1`; confirm RED.
- [ ] Implement section preference controls and native row actions; reuse queue sources/readiness. Add bounded focus metadata only for task/request/diary/booking lists that need it, consuming after load and falling back neutrally for unavailable targets. Do not add role-name switches or hide mandatory warnings.
- [ ] Run focused tests and `tests/e2e/role-journeys.spec.ts`; require GREEN.
- [ ] Commit personal work improvements.

### Task 5: Deliver Accessible Saved Filter Management

**Files:** Create `src/components/news/SavedNewsFilters.tsx`; modify `src/views/NewsListView.tsx`, `src/views/HelpView.tsx`; test `tests/e2e/saved-news-filters.spec.ts`.

**Interfaces:** Component consumes typed definitions/current filter and confirmed API mutation wrappers from Tasks 1-2. It applies via one `onApply(definition: SavedNewsFilterDefinition)` callback. Use existing Modal, dialogs, online status, notifications and lucide buttons.

- [ ] Write browser tests for create/rename/update/pin/delete/reload, 80-character name and field errors, unavailable references, connection loss, failed save/retry, stale concurrent edit, keyboard menu/dialog Escape and trigger focus. Verify account isolation in two sessions.
- [ ] Run `npx playwright test tests/e2e/saved-news-filters.spec.ts --workers=1`; confirm RED.
- [ ] Implement picker with overflow menu and management dialogs, pending/confirmed/error states, bounded names and accessible disabled reasons. Preserve previous saved record on failure. Do not claim success for queued/offline writes. Add Arabic help matching shipped behavior only.
- [ ] Run the same tests at 390px and 1440px, light/dark; add axe and overflow assertions to the cases. Require GREEN.
- [ ] Commit saved-filter UI and help.

### Task 6: Verify Phase One and Preserve Whole-Goal Scope

**Files:** Create `docs/releases/daily-role-ux-phase-one-verification.md`; update this plan checkboxes from actual evidence.

- [ ] Run `$env:PATH='C:\Program Files\Git\usr\bin;'+$env:PATH` in PowerShell, then `npm run check`; require TypeScript, full unit/server suite and production build pass.
- [ ] Run one serial Playwright command covering new phase-one suites, existing news customization, role journeys, navigation, keyboard, drafts and accessibility; record exact tests/counts and failures, not a blanket full-suite claim.
- [ ] Use a fresh whole-branch reviewer per executing-plans; resolve all findings with reproduction and regression tests before declaring the phase finished.
- [ ] Rebuild without e2e helper assets; verify production preview readiness and unchanged live database identity without destructive writes.
- [ ] Commit verification evidence. Do not publish a release labelled complete: continue to stage-two written design and the remaining roadmap stages before final goal completion.

## Final Integration After All Stages

The user authorizes implementation through merge, push and release. After all five stages are implemented and verified: fetch origin; inspect divergence; use a non-destructive integration strategy; rerun verification on the merged state. Bump package/lock/server/rehearsal versions consistently, update What's New and release notes to actual deliverables, create an annotated release tag, and push main plus the tag. Verify remote commit/tag and runtime version. A hosting release should be created using available GitHub tooling if repository convention requires one. Do not mark the goal complete without evidence for the complete roadmap, remote publication and release artifacts.

## Plan Self-Review

Phase-one requirements map to Tasks 1-6. The review-focus cases have explicit test owners. Existing news context is extended rather than duplicated; current page-size/columns remain compatible. Later stages are not claimed delivered by this plan. Await user review and execution-method selection before product edits.
