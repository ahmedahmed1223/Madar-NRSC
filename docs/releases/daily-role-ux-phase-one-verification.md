# Daily Role UX Phase One Verification

Date: 2026-10-10
Branch: codex/daily-role-ux
Status: Phase one verified; remaining roadmap awaiting stage-two specification review

## Implemented Scope

- Private server-owned saved news filters: strict typed definitions, authenticated
  ownership, timestamps, 30-record limit, captured-version update/delete and
  privacy across bootstrap, changes, tombstones and conflict responses.
- Confirmed filter picker and management: create, rename, replace definition,
  pin, delete and reload; failed saves preserve the draft, offline writes remain
  disabled, loaded definitions remain usable during the visit.
- Bounded per-user news context: filters, tab, page and item anchor only; missing
  category/author references remain restrictive until explicitly removed.
- My Work section visibility/order preferences with mandatory warning protection,
  station-time day classification and exact task/request/bulletin-story links.
- Arabic help follows the shipped behavior. Existing visual system and page-size/
  column preferences remain unchanged.

## Verified Evidence

- `npm run check`: TypeScript, 73 test files / 334 unit and server tests, and
  production build passed after independent-review fixes.
- Saved-filter browser suite: 4/4 passed; 390px and 1440px, light/dark axe checks,
  name validation, definition replacement, create/rename/pin/delete/reload,
  separate-account privacy, stale edit rejection, unavailable references,
  rejected-save retry, offline disabling and Escape/focus restoration.
- Task-three regression: 7/7 context and news UX browser tests passed.
- Task-four regression: 17/17 personal-work and existing role journeys passed.
- Comprehensive pre-review serial regression: 45/45 passed in 4.9 minutes across daily-work-context,
  daily-work-roles, saved-news-filters, news-customization, news-ux, role-journeys,
  navigation, editorial-keyboard, draft, form-drafts and accessibility suites.
  The post-fix run adds six daily-work-review-regressions cases: 51/51 passed in
  5.2 minutes. Neither run claims the entire e2e suite ran.
- Live SQLite read-only inspection: database identity
  `bbf2419a-00df-4a59-b62d-b7e31e5f825b`, revision 137. Browser mutation tests use
  the isolated e2e database, never the live database.
- Production rebuilt after e2e; `dist/offline-store-test.js` is absent.
  Local preview on http://localhost:3000 reports `/api/health` status ok, version
  3.25.0 and the original database identity; `/api/ready` reports ready/database true.
  Read-only SQLite inspection after startup still reports revision 137.
  Preview runs on loopback with seeding, outgoing delivery, wire polling and
  scheduled backups disabled; it is not a deployment or a new release.
- Final saved-filter screenshots inspected at 390px dark and 1440px light:
  legible primary action, reachable controls, no incoherent overlap or page overflow.

## Decisions and Costs

- Existing feature checkout instead of a new linked worktree: user chose execution
  here; less filesystem isolation, while main remains untouched.
- Narrow DB owner lookup for private tombstones: deleted wire rows omit payload;
  a wrong implementation could leak deleted-filter IDs, covered by changes tests.
- Direct confirmed sync wrapper and private versioned GET: the generic optimistic
  delete omits baseV; cost is maintaining one extra route, covered by real HTTP tests.
- Existing bounded category-name semantics retained: switching to IDs would break
  incumbent contexts; same-named categories retain existing shared semantics.
- Help data updated in `src/content/help.ts`, rather than the rendering view:
  preserves task-guide structure; discoverability relies on existing help search.
- Native pinned-first select and management modal replace a custom overflow menu:
  familiar keyboard/mobile navigation; scanning many filters may take longer.

## Remaining Scope

Phase one is not the full approved roadmap or a published release. Deadline-aware
review and shift handovers, production/crew preparation, reporter/presenter tools,
and actionable notifications/admin/viewer summaries remain stages two through five.
No main merge, version bump, tag or remote push is claimed here.

## Independent Review

A fresh gpt-6-astra reviewer inspected be8184a..e01b508 read-only. No critical
findings; four important findings entered one fix pass, with no second reviewer.

- Obsolete anchor after manual page/page-size changes: browser reproduction failed
  on the wrong restored item, then passed after explicit navigation clears the anchor.
- Stalled save/delete: bounded 12-second transport and explicit stop-waiting/Escape
  retain the draft; unknown outcomes reconcile the stable ID before retry. Unit
  timeout/cancellation tests and browser stalled/lost-acknowledgement cases passed.
- Confirmed filters lost after offline navigation: account-scoped in-memory confirmed
  metadata survives component remounts during the visit, without content caching or
  queued writes. Offline navigation reproduction failed then passed.
- Blocked sessionStorage at bulletin destination: guarded consumer keeps the
  bulletin usable when exact-story focus storage is refused. Browser RED then GREEN.

Deferred minor: after changing controls, select the blank option before reapplying
the currently selected filter. An explicit apply action or selection reset remains
optional follow-up; it does not affect confirmed persistence or access.

The reviewer declined later roadmap/release integration and the unfinished evidence
document. Rulings: later stages remain required (cost: premature publication could
omit approved scope); final evidence is completed only after verification (cost:
stale documentation could misstate readiness).
