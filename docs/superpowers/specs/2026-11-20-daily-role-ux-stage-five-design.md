# Daily Role UX Stage Five

Date: 2026-11-20

## Notification inbox

Keep the existing bell and delivery settings. Show urgent notices first, then
group other notices by their existing category. Within each group, show unread
notices before read notices, then newest first. Each notice has its own action
to open the existing internal link when the current account can open its screen.
Notices addressed to the account can also be marked read without opening them.

The user can snooze an individual nonurgent notice for one hour. The bell shows
the count of visible unread notices, and the inbox includes a collapsed snoozed
section with an immediate restore action. Expiry automatically restores the
notice. Keep only notice IDs and bounded expiry times in device storage under the
authenticated account. If storage is blocked, the choice works during the visit
and the inbox reports that it could not be saved on the device. Urgent notices
stay visible even if a previously snoozed notice becomes urgent. Snooze preserves
read status and operates independently of email, push, quiet hours and consent.

## Dashboard summaries

Account holders with `system.settings` and access to Settings see operational
exceptions from the existing restricted admin overview endpoint. The dashboard
shows the latest successful read time, error and warning counts, the first three
exceptions ordered by severity, and existing blocked and late work counts.
The monitor link opens the existing System Monitor. An unavailable response
shows a retry action and clears old data. The summary is read-only.

Accounts with `news.view` and access to the news screen whose news permissions
are read-only see a summary of approved and published news from the already
loaded news list. Show counts and the five most recently updated titles and
statuses. Opening one uses the existing news detail route and rechecks that the
item remains present and approved or published. Deleted rows, drafts, archived
rows and items with an active embargo are excluded. The summary uses current
read permissions and adds no fetch or offline store for news.

## Acceptance

- Snooze is account-scoped, expires, can be cancelled, and leaves urgent notices
  visible. Counts match the displayed notices. Broken storage degrades to the
  current visit. Group order and exact navigation remain deterministic.
- The admin summary uses the current existing permission and hides any stale
  response on account change or fetch failure. Empty, loaded and retry states
  are distinguishable.
- The viewer summary shows only eligible records and actions, including for
  customized roles, and disappears if the news screen or permission is removed.
- Keyboard actions use native controls. Escape closes the bell and restores
  trigger focus. Verify both summaries and the inbox in Arabic RTL at desktop
  and narrow widths with the integrated branch checks.
