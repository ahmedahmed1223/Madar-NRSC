# Daily Role UX Phase Two Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order editorial review by actual authorized broadcast deadlines and provide explicit, permission-controlled shift publication and receipt.

**Architecture:** A shared pure deadline selector feeds existing review queues. Dedicated authenticated handover endpoints use SQLite transactions and current policy checks, outside the generic mutation journal. Existing roster and dashboard surfaces host the workflow.

**Tech Stack:** Existing React, TypeScript, Express, SQLite, Vitest and Playwright; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-daily-role-ux-phase-two-design.md` (approved by the user on 2026-10-11).

## Global Constraints

- Preserve Arabic RTL, current design, mobile/desktop, keyboard behavior and live/offline-air behavior.
- No automatic approval, assignment, roster change, broadcast command or reconnect replay.
- Server permissions, current roster membership and current target readability are authoritative; do not infer access from role names or a missing department default.
- Schema version 1; title 120, general note 2000, reference note 500, receipt note 500 characters; at most 30 unique references.
- Reference collections: news, bulletinStories, bulletins, episodes, tasks, requests. No copied article body, attachments or arbitrary URL.
- Published records and receipts are immutable; corrections create a new publication and never inherit receipts.
- All sensitive writes are confirmed, versioned and transactional. Stable identifiers reconcile uncertain outcomes before explicit retry.
- Handovers and receipts are absent from generic bootstrap/changes and reject generic writes, including conflict payload disclosure.
- Unknown or ambiguous station wall times are unknown deadlines, never guessed. Past deadlines remain overdue until explicit completion.
- Reminder cooldown is 10 minutes per publication/recipient shift. Respect existing notification preferences.
- Browser mutations use isolated test data. Preserve live database identity. No release or merge before the entire approved roadmap is verified.

## Review Focus

1. Invalid date/zone, midnight, device mismatch and both DST transitions: Task 1 owns deterministic selector tests.
2. Forged actors, guessed IDs, custom permissions, missing structured department and revoked roster access: Tasks 2-3 own server tests.
3. Hidden/deleted references and conflicts: Task 3 owns projection and generic transport exclusion tests.
4. Duplicate receipts, corrections, notification consent and reminder races: Tasks 4-5 own transactional tests.
5. Offline, stalled requests, lost responses, account changes and keyboard/mobile focus: Tasks 6-7 own browser and transport tests.

## File Boundaries

| Files | Responsibility |
| --- | --- |
| src/shared/stationWallTime.ts, reviewDeadlines.ts | Explicit-zone conversion and shared queue ordering |
| src/shared/shiftHandovers.ts | Strict input models and projected response types |
| src/shared/rbac.ts, collections.ts | Explicit permission registry/defaults and server-only collection registration |
| src/server/shiftHandovers.ts | Authorization, projection, transactions and dedicated routes |
| src/server/app.ts, policy.ts, sync.ts | Route mounting and generic read/write exclusion |
| src/server/notifications.ts | Existing delivery integration, without changing transport consent |
| src/services/api.ts, handoverTransport.ts | Bounded confirmed requests and reconciliation |
| src/components/roster/ShiftHandovers.tsx | Draft, publication, correction, receipt and reminder UI |
| src/views/RosterView.tsx, NewsListView.tsx | Existing tab integration and shared review deadlines |
| src/components/dashboard/MyWorkPanel.tsx, src/App.tsx | Incoming summary and existing exact-target navigation |
| src/content/help.ts | Actual delivered Arabic help in the existing searchable guide |

### Task 1: Station Deadlines and Review Queue

**Files:** Create shared helpers above and `tests/shared/reviewDeadlines.test.ts`; modify NewsListView and MyWorkPanel.

**Interfaces:** `stationWallTime(date: string, time: string, zone: string): number | null`; `selectReviewDeadlines(news, bulletins, stories, episodes, zone, now): ReviewDeadline[]`. Each result contains newsId, nullable deadlineMs, nullable authorized destination and overdue flag. Inputs are typed existing entity arrays already restricted to readable entities; use one evaluation instant.

- [ ] Write failing tests for earliest duplicate links, killed/floated/deleted stories, DONE bulletins, terminal episodes, unknown schedule, overdue, priority/submission/stable-ID ties, midnight, invalid calendar dates, device mismatch and ambiguous/nonexistent DST times. Assert both DST cases return null and completed targets never supply a deadline.
- [ ] Run `npm test -- tests/shared/reviewDeadlines.test.ts`; verify RED.
- [ ] Implement strict wall-time resolution with bounded candidate-offset verification, then shared ordering: known deadline ascending, priority descending, submission ascending, ID ascending. Unknown deadlines retain priority/age ordering.
- [ ] Integrate both queues, refreshing once per minute; retain current exact review navigation and neutral revoked-target fallback. Show the specified unknown label and overdue/remaining metadata.
- [ ] Run focused tests and `npm run typecheck` after checking package script names; verify GREEN and commit.

### Task 2: Validated Records and Explicit Permissions

**Files:** Create shiftHandovers shared model and `tests/shared/shiftHandovers.test.ts`; modify collections/rbac; add focused permission tests in existing server test layout.

**Interfaces:** `HandoverDraftInput` contains id, schemaVersion, departmentId, source/recipient date and shift, title, note, references and optional supersedesId; no actor or timestamp fields. `HandoverRow` contains v and server-owned record. `ProjectedReference` is a discriminated readable target or `{ available: false }`, with no hidden ID/collection/note. `HandoverReceipt` contains publicationId, userId, server timestamp and optional note.

- [ ] Test exact length boundaries, duplicate references, unknown fields, valid calendar dates/shifts, unsupported collections and forged metadata. Assert invalid inputs fail rather than silently truncate.
- [ ] Test handover.view/publish/manage effective custom overrides and unchanged custom-role permissions; run focused tests to establish RED.
- [ ] Implement strict validators and register permission codes. Seed explicit appropriate default-role permissions without expanding existing custom role records. Register handovers/receipts as server-only collections.
- [ ] Run focused tests, verify GREEN and commit.

### Task 3: Private Versioned Draft and Publication API

**Files:** Create server shiftHandovers module; modify app/policy/sync; create `tests/server/shiftHandovers.test.ts` using createTestServer/loginAgent.

**Interfaces:** Mount dedicated `/api/v1/shift-handovers`: GET list, GET `/:id`, POST draft, PATCH `/:id` with captured baseV, DELETE `/:id` with baseV, POST `/:id/publish` with baseV. Return projected versioned rows; authenticated forbidden/not-found responses do not reveal records. Conflicts return only currently readable projected state. Use existing NewsroomDatabase transaction/writeRow/revision emission contracts.

- [ ] Test private draft CRUD, own source department/roster authority, cross-department manage visibility, publish requiring view, stale baseV, forged actor/time, guessed IDs and roster revocation. Assert read-only manager never impersonates an author.
- [ ] Test generic bootstrap/changes exclusion and generic upsert/delete denial for both collections. Test inaccessible reference projection including conflict responses contains no target ID/title/note/collection.
- [ ] Run server tests to verify RED; implement fresh policy checks before lookup disclosure and inside transactions. Validate selected targets and project every read using current canRead. Stamp metadata on the server.
- [ ] Make publication immutable. Corrections are new drafts with validated previous publication/department relationship; manage permits a new correction authored by the current actor.
- [ ] Run focused tests, verify GREEN and commit.

### Task 4: Explicit Receipt and Safe Retry

**Files:** Server module, api.ts, new handoverTransport.ts; server tests and `tests/client/handoverTransport.test.ts`.

**Interfaces:** POST `/:id/acknowledge` with optional note creates deterministic publication/user receipt; GET detail returns authorized receipt summary. ApiService exposes list/get/save/delete/publish/acknowledge with AbortSignal and baseV where applicable. A dedicated transport has a 12-second timeout and explicit unknown-outcome error; no mutation journal.

- [ ] Test that reading creates no receipt, author cannot self-ack, recipient membership is required at request time, repeated receipt is idempotent and published edits/deletes fail. Assert corrections have zero inherited receipts.
- [ ] Test abort/stall/lost-response reconciliation with stable draft/publication/receipt IDs; no automatic resend after reconnect. Run to verify RED.
- [ ] Implement transactional receipts and bounded transport. Explicit retries first fetch authorized state: matching committed outcome confirms, divergent version requires review, absent outcome permits deliberate retry. Keep user draft on cancellation/failure.
- [ ] Run focused tests, verify GREEN and commit.

### Task 5: Consent-Aware Alerts and Reminders

**Files:** Server handover module/notifications integration; `tests/server/handoverNotifications.test.ts`.

**Interfaces:** POST `/:id/remind` explicitly requests reminders; server determines current eligible recipients, missing receipts and permissions. Stable notification keys derive from publication/user and cooldown bucket; persisted cooldown is enforced transactionally, not in process memory.

- [ ] Test publication deduplication, disabled channels, current membership/access, missing receipts, hidden-reference-free content and concurrent reminder cooldown at 599999/600000 ms boundaries.
- [ ] Run to verify RED; implement using existing notification categories/preferences and delivery service. No urgent bypass, new transport or hidden target metadata.
- [ ] Run focused tests, verify GREEN and commit.

### Task 6: Roster Workflow and Incoming Work Summary

**Files:** ShiftHandovers component, RosterView/MyWorkPanel/App integrations, help data; `tests/e2e/shift-handovers.spec.ts`.

**Interfaces:** Component receives currentUser and an existing authorized target-navigation callback adapted at App. Draft editor uses confirmed API, bounded references and local draft protection; account-scoped context is cleared on account change. Incoming summary consumes dedicated API only.

- [ ] Write outgoing editor/incoming editor/producer/crew browser journeys: draft save, publish confirmation audience/count, open exact targets, explicit receipt, missing receipt inspection and explicit correction. Assert no roster/task/broadcast state changes.
- [ ] Run focused Playwright test after isolated build to verify RED.
- [ ] Add existing-roster tab and compact rows, native field controls and existing dialogs. Distinguish saved/published/received states. Explain disabled actions for permission, wrong shift, offline and required fields. Keep unavailable refs neutral.
- [ ] Preserve drafts on HTTP errors, bounded waiting cancellation and uncertain outcomes. Do not queue reconnect writes. Document only delivered behavior in Arabic help.
- [ ] Run browser tests serially, verify GREEN and commit.

### Task 7: Hardening and Phase Verification

**Files:** `tests/e2e/shift-handover-resilience.spec.ts`, affected accessibility tests, `docs/releases/daily-role-ux-phase-two-verification.md`.

**Interfaces:** Reuse isolated Playwright data setup and current role fixtures; no live account mutation. Verification records exact commands/counts and remaining roadmap scope.

- [ ] Add tests for HTTP failure, stall/cancel, committed write with lost response, revoked permission, offline reconnect, blocked storage and account change. Assert retained draft, no false success, no duplicate publication/receipt and no replay.
- [ ] Test 390/1440 widths, light/dark RTL, 44px actions, no horizontal overflow, Tab/arrows/Escape/focus return and axe checks. Inspect screenshots, including populated/error states.
- [ ] Run `npm run check`, then affected phase-one and phase-two Playwright suites with `--workers=1`; build before browser, never concurrently. Rebuild afterward to remove test-only artifacts and check preview health/readiness and live DB identity without mutation.
- [ ] Self-review the phase diff and address actionable findings with focused regression tests. Preserve the already authorized independent whole-branch review for final integration after all roadmap stages; do not spawn per-task reviewers.
- [ ] Record actual evidence, update plan/spec status and commit. Do not claim later stages or release completed; proceed to the next stage's specification gate.

## Execution Handoff

Self-review this plan against every specification requirement before committing. The chosen method remains native execution here with an independent final review. Present the plan for user review and wait for plan approval before product implementation. Stages three through five and final verified main merge/push/release remain required.
