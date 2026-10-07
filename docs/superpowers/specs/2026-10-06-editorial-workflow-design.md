# Editorial Workflow Reliability and Team Experience

Date: 2026-10-06
Status: User approved on 2026-10-07; implementation plan awaiting review.

## Intent and Scope

Implement all eight approved recommendations by extending the existing newsroom,
bulletin, task, comment, notification and mobile workflows. Reduce manual follow-up,
make readiness explainable, preserve editorial work, and test a complete multi-user
journey. Retain Arabic-first UI, existing role permissions and station time semantics.
Do not replace the application shell, create a second task system, or touch live data
in tests. Approval of this specification is required before the implementation plan.

## Current Findings

- BulletinStory already records newsId and newsUpdatedAt. StoryEditor detects a
  newer source but refreshFromNews immediately replaces the local script.
- StoryEditor.save currently announces success and closes before server acceptance;
  fixing the rundown metadata did not fix this separate story-editing path.
- Existing comments are append-only for clients except author/admin deletion.
  Resolving a review thread must not silently weaken that policy.
- EditorialTask already supports assignment, due date and related entities.
- MyWorkPanel, newsroom review queues, bulletin approval chains and edit locks
  already exist and should be extended rather than duplicated.
- Client sync has row versions and awaitWrite; they remain the concurrency and
  acknowledgement mechanism. No new parallel persistence layer is introduced.

## 1. Manager Work Queue

Add a work-queue view inside BulletinsView with access under bulletins.view.
Show the user's assigned bulletins and stories waiting for their actual next
approval step. Managers with bulletins.manage can select a wider team scope.
Sort by station air date/time, then waiting duration. Filters: next approval,
missing requirements, overdue work and unassigned work. Every row opens the
relevant story or task; counts use the same selectors as rows.
Keep the existing rundown and date navigation as the default operational view.
Do not grant editing or approval rights merely because an item is visible.

## 2. Readiness Before Air

Create a shared, deterministic readiness evaluator for bulletin stories. Evaluate
script, positive duration, required video for clip-based story types, approval-chain
completion, active source embargo and newer source revisions. Killed/floated
stories do not block the active rundown. READER stories do not require video;
BREAK stories do not require a script. Graphics and presenter assignment are
warnings unless required by an explicit existing contract.

Separate blockers from warnings and label the cause and responsible person, or
explicitly show unassigned. Reuse results in the queue, rundown and pre-air view.
The server independently checks hard blockers for transitions into LIVE; a client
badge is not authorization. Do not stop an already-live broadcast automatically
when another user changes readiness. Add no universal override in this scope.
The app can check stored references and metadata, not guarantee an external video
URL is playable or prove the factual accuracy of a script.

## 3. Confirmed Writes

Audit bulletin-story editing, metadata, templates, source additions, copying,
deleting, ranking, generated headlines and linked production requests, plus task,
program and episode form save paths. Use existing awaitWrite acknowledgements.
Show unsaved, saving, confirmed and failed/pending states distinctly. Preserve
input on refusal. Disable duplicate submission and protect exit while saving.
Success and form closure occur only after accepted writes.

For multi-record actions, list confirmed and unconfirmed items separately. Retry
only unconfirmed records, retaining operation identities while writes are pending
to avoid creating duplicates. Undo is itself an acknowledged write. Conflict does
not become automatic overwrite. Do not promise server persistence while offline;
local recovery remains separately labelled. Add per-user recovery to audited
forms that currently lack it, using the existing useFormDraft pattern.

## 4. Text-Linked Review Threads

Reuse comments for immutable messages and replies. Extend an optional review
anchor with entity id, field, base row version, quoted plain text and context.
Bound quote length to 2000 and context to 200 characters per side. Render as text,
never raw HTML. A thread stays visible when the quote is stale or ambiguous;
do not guess a new location based only on a paragraph index or substring.

Add a small reviewThreads collection for thread state and anchor metadata; reply
messages remain in comments with a threadId. Resolve/reopen operations use row
versions and server-stamped actor/time. Access follows the target entity's read
permission; posting follows its editorial edit/review permission. The reviewer or
authorized editor resolves/reopens; authors may reply but not approve their own
material by resolving a thread. Discussion resolution does not itself change news
status. Cross-entity thread/reply references are rejected on the server.

## 5. Compare Source Updates

Use the current newsUpdatedAt marker to flag source changes. Store an optional
plain-text source snapshot when news is added or refreshed. Show current local
script and latest source side by side on desktop, sequentially on mobile, with
the historical imported text when available. Use a maintained diff library only
if an inline diff is needed; side-by-side comparison needs no new dependency.

For legacy records without a snapshot, clearly state that the imported original
is unavailable. Never fabricate a three-way merge. Offer cancel, manually edit,
or explicitly replace from source. Replacement stays an unsaved edit until server
confirmation; do not change newsUpdatedAt without applying the source. Editing an
approved story invalidates approvals according to existing server rules. Preserve
local script for undo and confirm before undo overwrites later edits.

## 6. Assignment and Delivery

Extend EditorialTask.relatedEntityType to support BULLETIN and BULLETIN_STORY.
Reuse task assignee and dueDate, with a station-zone-aware date/time input.
Show overdue and unassigned work in manager and personal queues. Validate active
assignees, linked entity existence and existing task permissions on the server.
Do not create an independent assignee field that disagrees with the task record.

Notifications occur on assignment, meaningful due-date changes and entering a
blocked/ready state. Deduplicate by task transition and recipient. No repeated
overdue polling notifications and no reminders scheduler in this scope. Task
completion never substitutes for editorial approval or media availability.

## 7. Mobile Task-Focused Experience

Extend MyWorkPanel for assigned stories/tasks and pending approvals. Preserve
the common application shell. Use a stable bottom action strip in editors,
44px primary touch targets, collapsed secondary tools and visible save state.
Readiness blockers and review notes remain reachable; do not hide them behind
decorative dashboards. Compare text sequentially on small screens. Verify 390,
768 and 1440px layouts, both themes, keyboard focus and RTL. No horizontal page
overflow or sticky controls covering the final field.

## 8. Multi-User Acceptance Journey

Use a fresh isolated test database and independent authenticated contexts for
writer, editor, bulletin manager and authorized control-room operator. Create a
news story through UI, reload its draft, submit it, attach a review thread, return
with notes, revise and approve, then add it to a bulletin. Assign preparation work,
complete required media/duration, collect every configured approval, and enter
on-air only when hard blockers clear. Verify actual accepted rows, not just toasts.

Change source news after import, inspect comparison, cancel replacement and
verify local script survives; then accept replacement and reapprove. Inject a
rejected write and delayed acknowledgement, and test two-editor lock/version
conflicts. Cover an active embargo, wrong-role direct API calls and partial-copy
retry without duplicates. Verify an As-Run entry only after a real on-air action;
opening the log is not proof that recording works.

## Delivery and Acceptance

Sequence: confirmed writes and safe source comparison; shared readiness and server
pre-air enforcement; task-linked manager queue; anchored review threads; mobile
polish; full journey and regression suite. Existing records must remain readable
with every new optional field absent. Add no destructive data migration.

Each slice needs focused failing-then-passing tests, server policy tests where
relevant, and browser evidence. Final acceptance requires typecheck, unit tests,
production build, multi-user journey, existing critical browser suite and axe
checks for changed surfaces. Document observed results and remaining limitations.
Implementation does not automatically commit/push a release or change version;
integration and release are separate user-directed operations.
