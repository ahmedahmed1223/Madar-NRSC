# Daily Role UX Phase Two: Review Deadlines and Shift Handover

Date: 2026-10-10
Status: Approved by the user on 2026-10-11; implementation plan awaiting review
Prerequisite: Phase-one implementation and independent review fixes

## Intent and Selected Approach

Help editors choose the next time-sensitive review and let outgoing colleagues
explicitly hand work to the incoming shift. Keep Arabic RTL desktop/mobile flows,
customized permissions, confirmed persistence and live-broadcast safety intact.
The full daily-role roadmap is approved; this document specifies stage two only.

Extend the existing news review queue and duty-roster view. A separate review
dashboard would duplicate queues; an automatic shift/workflow engine would change
editorial responsibilities. The selected approach uses shared pure deadline
selectors, explicit handover records and immutable receipt events.

## Existing Sources and Boundaries

- NewsListView and MyWorkPanel already show UNDER_REVIEW news, currently ordered
  by priority and submission age. Both must use the same new deadline selector.
- BulletinStory.newsId links news to Bulletin.date/startTime. Floated, killed,
  deleted stories and DONE/deleted bulletins do not create an active deadline.
- Episode.linkedNewsIds and rundown/rundownSegments newsId links connect news to the episode's
  broadcastDate/startTime. Deleted, CANCELLED, ARCHIVED and BROADCASTED episodes
  do not create active deadlines; duplicate links count once.
- RosterView and shared roster models already contain departments, dates, shifts,
  users and shift leads. Keep the roster itself unchanged in this stage.
- Existing sync versions, authenticated actor, server policy, notifications and
  exact-entity navigation are reused. No new delivery transport or broadcast action.

## Review Queue

Derive deadlines only from currently authorized linked broadcasts. Display the
earliest valid active broadcast start, its authorized destination and either
remaining time or lateness. A past start remains overdue until that broadcast is
marked completed; do not infer completion from elapsed time. A deadline means the
planned broadcast start, not a promise of automatic approval.

Sort known deadlines first, earliest deadline first (overdue first), then existing
priority, review submission time and stable news ID. Undated news is clearly
labelled "موعد البث غير محدد" and uses the existing priority/submission order.
Neither an embargo nor a news publication date is substituted for a broadcast.
Use one evaluation instant for the whole queue update, refreshed every minute.

Resolve plain date/time values using the configured station IANA timezone,
independent of the device timezone and display calendar. Invalid date/time or
zone, nonexistent DST wall time, and ambiguous repeated DST wall time result in
an unknown deadline, never a fabricated instant. Test both DST boundaries.
Reuse existing date helpers where correct; isolate any explicit-zone conversion
needed so it does not change unrelated date-entry behavior.

The next-review action opens the exact accessible news item using the current
review navigation callback and queue. Removing/revoking a target falls back
neutrally. Review sorting never approves, submits, publishes or starts broadcast.

## Explicit Shift Handover

Add a "تسليم الوردية" tab to the existing roster view and a compact incoming
handover summary to MyWorkPanel. No separate dashboard or nested section cards.

An outgoing colleague creates a private draft for one department, a source shift
and a recipient shift. The recipient is a department/date/shift, not an implied
assignment to one user. The author chooses references and writes bounded plain
text notes. Publication requires an explicit confirmation showing that destination
and the number of references. There is no automatic publication on logout or at
a time boundary.

Handovers contain only:

- ID, schemaVersion 1, departmentId, source/recipient plain ISO date and ShiftId.
- Author and server-owned createdAt/updatedAt/publishedAt; state DRAFT or PUBLISHED.
- Title up to 120 characters, general note up to 2000 characters.
- At most 30 unique references to news, bulletinStories, bulletins, episodes, tasks
  or requests; each contains a validated collection/ID and plain note up to 500
  characters. No copied article body, attachment, arbitrary URL or query payload.
- Optional supersedesId for an explicit new correction of a published handover.

The author can update/delete a private draft using a captured base version.
Published content is immutable. Corrections create a new handover, explicitly
linking the previous record; earlier acknowledgements remain tied to the original
publication and are not carried forward automatically. The server validates the
source/correction relationship and department, and stamps every actor/time.
Retention and bulk archival are not introduced by this stage.

## Permissions and Safe Reads

Introduce explicit configurable permissions handover.view, handover.publish and
handover.manage in the existing permission registry and role editor. Client and
server consult effective permissions, not role-name switches. Seeded default
roles may receive those permissions explicitly; existing custom roles are not
silently expanded.
Publishing also requires handover.view; a custom role granted publish without
view receives an explicit permission explanation rather than hidden implicit access.

- view: published handovers for the authenticated user's structured department
  or a recipient roster shift containing that user; private drafts only to author.
- publish: create/update own drafts and publish for the user's department, or a
  department where the user is explicitly assigned in the source roster shift.
- manage: inspect authorized department handovers across departments and create
  a correction, never impersonate another author or acknowledgement actor.
- Acknowledgement requires view access and explicit membership in the recipient
  roster shift. The author cannot acknowledge their own handover. A manager can
  see missing receipts and send an explicit reminder, not fabricate a receipt.

Stored handover/receipt collections are not exposed through generic bootstrap,
changes or generic sync writes. Use narrow authenticated, versioned endpoints
with confirmed transactions and no optimistic mutation journal. Endpoint list and
conflict responses project references against current target canRead checks:
inaccessible targets disclose neither ID, title, note nor collection details, only
a neutral unavailable item. The general department note remains visible to the
handover's authorized audience; the UI clearly identifies that audience before
publication. Never auto-copy hidden content into those notes.

Acknowledgement is an immutable receipt with deterministic handover-publication/
user identity, server-stamped actor/time and an optional 500-character note. Retry
is idempotent. Reading the handover never marks it acknowledged. Removing a roster
assignment revokes future acknowledgement eligibility, not historical audit facts.

## Interaction and Failure Handling

On desktop, show compact rows: destination, state, author, published time, receipt
count and one primary next action. On mobile, metadata wraps and actions remain
44px minimum; references open existing exact-target routes. Display unavailable
references neutrally. Native select/tab controls and existing dialogs preserve
keyboard arrows, Tab, Escape and return focus.

Differentiate draft saved, handover published and receipt confirmed. Disabled
publication/receipt actions explain permission, wrong shift membership, connection
loss or missing fields. A bounded request can stop waiting without losing draft
fields; unknown outcomes reconcile stable IDs before retry. No queued publication,
receipt or reminder is automatically sent on reconnection. Preserve local draft
fields using the existing draft-protection contract; this is not an offline server
save and does not add a cache of linked content.

Publishing alerts only currently eligible recipients using existing notification
preferences and delivery rules, with a stable deduplication key. Reminder is an
explicit permitted action, at most once per handover/recipient shift in ten minutes.
Acknowledgement alone does not complete tasks, approve news or change roster/broadcast.

## Acceptance and Tests

1. Pure deadline tests cover earliest multi-link join, duplicate links, unknown
   schedule, killed/floated/deleted targets, completed broadcasts, overdue starts,
   priority ties, device/station mismatch, midnight and ambiguous/nonexistent DST.
2. Server tests cover custom permission overrides, forged actors/times/departments,
   private drafts, recipient membership, revoked membership, guessed IDs, projected
   hidden references and conflict payloads, generic bootstrap/changes/sync denial.
3. Draft/update/delete/publish/correction tests prove captured-version conflict
   protection and published immutability. Receipt tests prove no implicit reading
   acknowledgement, self-ack denial and deterministic retry with no duplicate.
4. Browser journeys simulate outgoing editor, incoming editor, producer and crew:
   create a handover, publish, open accessible targets, acknowledge explicitly,
   inspect receipts, and recover from a deleted/inaccessible reference.
5. Browser tests prove draft preservation and no false success for HTTP failure,
   unresolved request, lost acknowledgement and disconnection/reconnection.
6. Notification tests verify delivery consent, deduplication and reminder cooldown;
   no unsupported user receives target details.
7. Test 390px/1440px, light/dark, Arabic RTL, keyboard-only focus and axe/overflow.
   Run TypeScript, full unit/server suite, serial affected journeys and independent
   final branch review before reporting stage-two completion.

## Exclusions and Next Gate

No auto approval, publication, task transfer, roster mutation, broadcast command,
new upload system, media/crew checklist, reporter/presenter changes or notification
redesign. Stages three through five remain required before final merge/push/release.

Self-review: bounded fields and states, explicit permission/recipient rules,
read projections, version conflicts, unknown outcomes and measurable tests are
specified. No placeholders. Await written-spec review before writing the stage-two
implementation plan; implementation requires that plan's review and execution choice.
