# Editorial Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution or superpowers:subagent-driven-development if the user selects delegation. Implement task-by-task; do not start before plan review and execution-method selection.

**Goal:** Implement all eight approved recommendations without duplicating the existing newsroom infrastructure.

**Architecture:** Extend current entity collections, row-version concurrency and acknowledgement APIs. Shared pure selectors drive manager queues and readiness; server policy remains authoritative. Build independent slices in dependency order, with focused regression tests for each slice.

**Tech Stack:** React, TypeScript, Express, SQLite entity store, Vitest, Playwright and axe.

**Spec:** `docs/superpowers/specs/2026-10-06-editorial-workflow-design.md`

## Global Constraints

- Arabic-first UI, existing role permissions and station time semantics.
- No replacement application shell, second task system or live-data test writes.
- No destructive migration; all new fields optional for existing records.
- Success means server acknowledgement, not an optimistic browser update.
- Integration, version bump and push require a separate user-directed operation.

## Review Focus

- A delayed write may finish after timeout: retry must reuse its identity (Task 1).
- Source changes again during comparison: do not stamp an unseen revision (Task 2).
- A source embargo changes after the UI check: server still refuses LIVE (Task 3).
- A reviewer loses permission after loading a thread: server refuses modification (Task 5).
- Station midnight/DST changes the queue day: deadlines and air dates remain coherent (Task 4).

## Task 1: Finish Confirmed Writes and Recovery

**Files:** Modify `src/components/bulletins/StoryEditor.tsx`, `src/views/BulletinRundownView.tsx`, `src/views/TasksView.tsx`, `src/views/ProgramsView.tsx`, `src/views/EpisodesView.tsx` and their existing form components where saves are owned. Extend `tests/e2e/bulletin-save-confirmation.spec.ts` and `tests/e2e/form-drafts.spec.ts`.

**Interfaces:** Consume `dataStore.awaitWrite(collection, id)` and `useFormDraft`. Keep existing ApiService signatures; retain ids of pending creations. No new persistence API.

- [ ] Add tests for rejected StoryEditor save/approval: fields and reviewer notes remain; success callback does not run. Add delayed acknowledgement, repeated submit, partial copy, delete, reorder undo and generated-headline failure cases.
- [ ] Run the focused browser tests against a fresh isolated database and record the failing assertions before editing product code.
- [ ] Make each audited path wait for acceptance; guard double-submit and exit while saving. On partial writes retain confirmed/unconfirmed identities and retry only unconfirmed items. Use local draft recovery separately from server save state.
- [ ] Run `npm run check` and the focused confirmation/draft specs; expected all pass, including reloading recovered input without creating a server record.
- [ ] Review changes and record task outcome; commit only when integration is requested.

## Task 2: Safe Source Comparison

**Files:** Modify `src/shared/bulletins.ts`, `src/components/bulletins/StoryEditor.tsx`, `src/views/BulletinRundownView.tsx`; create `src/components/bulletins/SourceComparison.tsx`, `src/shared/sourceComparison.ts`, `tests/sourceComparison.test.ts`, `tests/e2e/source-comparison.spec.ts`.

**Interfaces:** Add optional `BulletinStory.newsSourceSnapshot: string`. Produce `sourceComparison(story: BulletinStory, news: NewsItem): { current: string; latest: string; imported?: string; sourceUpdatedAt: string }`. SourceComparison accepts this value and onCancel/onReplace callbacks; no automatic merge.

- [ ] Test legacy missing snapshots, empty/literal-markup text, changed source, cancelling comparison and undo after later edits. Include a source change while comparison is open.
- [ ] Run the unit/browser cases red.
- [ ] Store the imported plain-text snapshot on source pull; show local/latest/imported text without HTML injection. Replacement explicitly confirms, preserves undo and remains unsaved. If source stamp changed since opening, refresh the comparison rather than apply the stale selection.
- [ ] Verify accepted replacement updates snapshot/stamp, invalidates approvals through existing server rules, and cancellation leaves local script/stamp unchanged at 390 and 1440px.
- [ ] Review diff and record outcome.

## Task 3: Readiness and Pre-Air Enforcement

**Files:** Create `src/shared/bulletinReadiness.ts`, `src/components/bulletins/ReadinessPanel.tsx`, `tests/bulletinReadiness.test.ts`, `tests/server/bulletinReadiness.test.ts`; modify `src/views/BulletinRundownView.tsx`, `src/server/policy.ts`, `src/shared/onair.ts` as needed by the existing on-air contract.

**Interfaces:** Produce `evaluateBulletinReadiness(bulletin: Bulletin, stories: BulletinStory[], news: NewsItem[], media: MediaItem[], now: Date): ReadinessIssue[]`, with issue fields `storyId`, `code`, `severity: 'blocker' | 'warning'`, `message`, `responsibleId?`. Use actual repository media type export; no duplicate MediaItem model.

- [ ] Test READER without video, BREAK without script, clip stories missing references/durations, empty required script, unfinished approval chain, active embargo, killed/floated exclusions and newer source warning.
- [ ] Run unit and direct-API policy tests red; include changed embargo after client readiness check and wrong-role LIVE requests.
- [ ] Implement shared rules from story type metadata; render blockers separately from warnings. Apply hard checks server-side when entering LIVE, never automatically stop an already-live broadcast.
- [ ] Run policy and browser tests showing each cause opens its story. Confirm no external URL-playability or editorial-accuracy guarantee is claimed.
- [ ] Review diff and record outcome.

## Task 4: Task Links and Manager Queue

**Files:** Modify `src/types/index.ts`, `src/views/TasksView.tsx`, `src/views/BulletinsView.tsx`, `src/components/dashboard/MyWorkPanel.tsx`, `src/server/policy.ts`, `src/server/notifications.ts`; create `src/shared/editorialQueue.ts`, `src/components/bulletins/ManagerWorkQueue.tsx`, `tests/editorialQueue.test.ts`, `tests/e2e/manager-queue.spec.ts`.

**Interfaces:** Extend EditorialTask.relatedEntityType with `BULLETIN | BULLETIN_STORY`. Produce `managerQueue(input: { user: User; bulletins: Bulletin[]; stories: BulletinStory[]; tasks: EditorialTask[]; readiness: ReadinessIssue[]; now: Date; teamScope: boolean }): ManagerQueueRow[]`, carrying entity ids, next action, station air date/time, assignee and deadline. Current permissions determine permissible scope/actions.

- [ ] Test own next-step approvals versus another approver, manager team scope, linked tasks, unassigned/overdue filters, DST/midnight boundaries and identical row/count predicates.
- [ ] Run selector and policy tests red; include invalid/deleted targets, inactive assignees and unauthorized reassignment.
- [ ] Extend task links using existing assignee/dueDate fields. Add queue tab to BulletinsView and personal items to MyWorkPanel. Assignment and meaningful transition notifications use existing recipients/preferences, deduplicated per accepted transition; no overdue polling scheduler.
- [ ] Verify row actions open the correct entity, changing assignment updates both queues, and completing a task never grants editorial approval.
- [ ] Review diff and record outcome.

## Task 5: Anchored Review Threads

**Files:** Modify `src/shared/collections.ts`, `src/shared/comments.ts`, `src/server/policy.ts`, `src/server/sync.ts`, `src/services/api.ts`; create `src/shared/reviewThreads.ts`, `src/components/editor/ReviewThreads.tsx`, `tests/server/reviewThreads.test.ts`, `tests/e2e/review-threads.spec.ts`; integrate into `src/views/NewsEditorView.tsx` and StoryEditor.

**Interfaces:** Register reviewThreads collection. Define `ReviewThread { id; collection: 'news' | 'bulletinStories'; entityId; field: 'content' | 'script'; baseVersion; quote; contextBefore; contextAfter; resolved; createdById; resolvedById?; resolvedAt? }`. Add optional comment.threadId. ApiService methods `createReviewThread(input)`, `replyToReviewThread(threadId, text)` and `setReviewThreadResolved(id, resolved)` follow existing sync signatures and acknowledgement rules.

- [ ] Test quote <=2000 and context <=200 per side, immutable messages, ambiguous/stale anchors, deletion of target, forged author/time, cross-entity replies and permission loss after load.
- [ ] Run policy tests red and browser tests proving author reply cannot grant approval.
- [ ] Validate entity read/edit/review permissions server-side, stamp actors and resolution times, and use row versions on resolve/reopen. Reuse comments for replies without weakening their append-only policy. Show stale anchors explicitly, never silently relocate.
- [ ] Verify reviewer thread creation, writer reply, authorized resolve/reopen and safe literal-markup rendering; entity workflow status remains unchanged by discussion resolution.
- [ ] Review diff and record outcome.

## Task 6: Mobile Integration and Accessibility

**Files:** Modify MyWorkPanel, ManagerWorkQueue, ReadinessPanel, SourceComparison, ReviewThreads, NewsEditorView and StoryEditor; create `tests/e2e/editorial-mobile.spec.ts`.

**Interfaces:** Consume existing task/queue/readiness/thread contracts. No extra data model or mobile-only navigation system.

- [ ] Add cases for 390/768/1440px, light/dark, long Arabic/Latin titles, focus return, keyboard-only review and last-field visibility above sticky actions.
- [ ] Capture pre-change screenshots and run layout/axe checks to identify actual failures.
- [ ] Keep primary actions stable with >=44px touch targets, collapse secondary tools, expose blockers and save status, and stack comparison text on small screens.
- [ ] Verify no page overflow, overlapping controls or inaccessible collapsed errors; capture final screenshots.
- [ ] Review visual evidence and record outcome.

## Task 7: Full Team Journey and Regression Gate

**Files:** Create `tests/e2e/editorial-team-journey.spec.ts`, `docs/EDITORIAL_WORKFLOW_VERIFICATION.md`; modify `.github/workflows/ci.yml`.

**Interfaces:** Consume all prior slice contracts and the existing isolated test server/auth helpers. Independent writer/editor/manager/control-room contexts perform real UI actions; API reads verify persisted outcomes.

- [ ] Create a draft through UI; reload, submit, review with an anchored note, return, revise and approve. Add to bulletin, assign preparation, fulfill requirements, collect every configured sign-off and enter on-air with the authorized operator.
- [ ] Add source update/comparison/cancel/replace/reapprove, active embargo refusal, rejected/delayed writes, version/lock conflict and partial-copy retry scenarios. Check an As-Run entry after a real air action, not merely opening the log.
- [ ] Run journey red for missing behavior, then complete the integration without weakening assertions or bypassing UI transitions.
- [ ] Run `npm run check`, all Playwright specs and changed-surface axe checks. Inspect screenshots and report real counts/failures; never write to live data.
- [ ] Add CI critical paths and document residual limitations. Request integration/version instructions only after verification is green.

## Coverage Review

Recommendations 1/6 map to Task 4; 2 to Task 3; 3 to Task 1; 4 to Task 5;
5 to Task 2; 7 to Task 6; 8 to Task 7. Every review-focus condition has an
explicit test in its owning task. No product changes have been made for this plan.

## Execution Choice

Recommended: native execution here, sequentially, because tasks share policy and
entity interfaces and the user has not requested parallel delegation. Alternatively,
user-approved subagent-driven execution can provide independent task reviews.
Review and choose before execution.
