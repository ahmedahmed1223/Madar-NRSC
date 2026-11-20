# Daily Role UX Phase Three Implementation

1. Add and test selectors for studio bookings and media work in `src/shared/productionWorkQueues.ts`. Reuse existing request types and ensure department and deletion filters apply before ordering. Add and test a personal receipt-state selector beside the existing handover types.
2. Extend `EpisodeWorkspaceView` with the derived preparation checklist. Reuse rundown blocker navigation and guest controls. When using `BookingForm` from the workspace, await the row-specific save and retain the same booking ID on retry. Subscribe to collection and sync changes so the checklist follows changes throughout a session.
3. Extend `RequestsView` with the handler-scoped delivery tab and result attachment flow. Keep `requestChangeError` and sync authoritative. Await media before linking its ID, await request write before success and mark any pending statuses in the view. Open linked segments with the existing episode navigation callback.
4. Extend `ShiftHandovers` and `RosterView` with a personal receipt filter and exact read, preserving the explicit Stage 2 acknowledgement. Verify pending, confirmed, ineligible and missing records.
5. Run focused tests and inspect the diff. Coordinate the branch-wide TypeScript, build and browser verification with the parent task.
