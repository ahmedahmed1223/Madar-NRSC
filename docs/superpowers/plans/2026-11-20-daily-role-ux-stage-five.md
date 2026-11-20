# Daily Role UX Stage Five Implementation Plan

Design: `docs/superpowers/specs/2026-11-20-daily-role-ux-stage-five-design.md`.

## Notification inbox

- Write focused Vitest cases in `tests/client/notificationInbox.test.ts` for
  urgency, grouping/order, account isolation, expiry and exact internal paths.
- Implement the tested selection and storage rules in
  `src/shared/notificationInbox.ts`. Put account and clock handling in
  `src/hooks/useNotificationSnoozes.ts`.
- Connect the selector and hook to `Topbar.tsx` and give
  `NotificationDropdown.tsx` native actions for opening, marking read, snoozing
  and restoring. Restore focus to the trigger when closing without navigation.

## Dashboard summaries

- Write `tests/client/dailyDashboardSummaries.test.ts` for exception ordering,
  row eligibility, ordering, limits and permission gates.
- Implement selection in `src/shared/dailyDashboardSummaries.ts`. Render the
  two compact panels from `DashboardView.tsx` with account and permission gates.
  Reuse the existing admin overview endpoint and its monitor detail route.
  Open news only when the current news store still contains an eligible item.

## Verification

- Run the focused Vitest tests red and green. Check staged files for whitespace
  errors. Run integrated type, build and browser checks with the branch owner.
- Review urgent reclassification, malformed storage, account changes, expired
  snooze, withdrawn approved material, custom screen restrictions, and failed
  fetches against the written design.
