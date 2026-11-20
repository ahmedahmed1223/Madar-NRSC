# Daily Role UX Phase Two Verification

Verified on 2026-11-20 on `codex/daily-role-ux`, with `origin/main` at `2f310ee` as an integration parent.

## Delivered Scope

- A shared editorial review selector orders authorized linked broadcasts by their
  earliest deadline, priority and review submission. Station-zone wall times are
  explicit; invalid dates and DST gaps/folds remain unknown. Completed broadcasts
  and floated/killed stories do not contribute deadlines.
- Dedicated versioned handover routes keep drafts private, stamp authenticated
  actors/times, enforce current department/roster/permission checks and publish
  immutable records. Corrections are separate records without inherited receipts.
- Generic bootstrap/changes/sync never disclose or mutate handovers/receipts.
  Unreadable references project only an unavailable marker, including conflicts.
- Explicit idempotent receipts and consent-aware assignment notifications use
  existing delivery infrastructure. Transactional ten-minute reminder cooldowns
  survive races/restarts without changing publication content.
- The existing roster and personal-work surfaces provide Arabic handover flows,
  exact reference navigation and incoming receipt summaries. Account-scoped local
  draft recovery is not a server-save confirmation. Offline writes are disabled;
  no reconnect mutation replay is introduced.
- Bounded cancellable requests reconcile stable identifiers before deliberate
  retries, including refresh after a lost create response. Divergent server
  versions require explicit review; loading them asks before replacing fields.

## Verification Evidence

- `npm run check` passed TypeScript, 690 unit and server tests across 110 files,
  and the production build, using the 4.0.0 dependency lockfile.
- The serial Chromium regression set passed 61 tests for daily work, saved
  filters, handovers, news and episode navigation, help, corrections, guest
  follow-up, and pronunciation. After adding the source-only publication
  confirmation, all 18 handover browser tests passed again.
- The handover tests covered 390 and 1440 pixels, light and dark RTL, keyboard
  entry and focus return, native shift selection, 44-pixel controls, overflow,
  and axe WCAG A/AA checks. Mobile error-state screenshots were inspected.
- The rebuilt preview reported 4.0.0, healthy, and ready on an isolated database
  with demo data disabled. The build excluded the browser-only storage helper.
- Remote `main` was verified at `2f310ee`. No live database was exercised.

## Hardening Findings Addressed

- The dialogue focuses the handover title and returns focus to its opener on close.
- Mobile error feedback scrolls into view without moving input focus offscreen.
- A refreshed uncertain create is reconciled by stable ID rather than repeated.
- A second confirmed save updates the recovery baseline before publication.
- A restored create conflict can explicitly load the current server version.
- Edits made after stopping an uncertain save are never marked as saved merely
  because the older write was confirmed. Fields remain local until explicit
  server-version review; the user confirms replacement.
- Review source arrays require explicit collection permissions before selectors
  consume them, rather than relying on permissive generic policy defaults.
- Outgoing roster members can confirm whether their own write published after a lost response. The confirmation returns only the publication state.
- The news desk uses one review queue and retains quality checks and claim indicators. Source filters and bounded item-relative list restoration work with the current filter panel.

## Decisions and Costs

- Reuse the existing isolated feature branch/checkout because execution here was
  approved. Cost: less filesystem isolation than a separate worktree.
- Preserve the authorized independent whole-roadmap review for final integration.
  Cost: phase-two author review has no fresh second perspective until that gate.
- Require explicit collection permissions before target readability checks.
  Cost: conservative references may omit access through a specialized workflow.
- Persist reminder cooldown as server-only operational metadata, incrementing the
  record version but not altering published content. Cost: operational reminders
  also change row versions.
- Reuse assignment delivery consent and in-app bell semantics. Cost: disabling
  external channels does not disable the existing in-app bell.
- Preserve existing UI components without adding daisyUI dependencies, following
  the approved no-dependency plan and repository design. Cost: current component
  conventions remain separate from that library.
- Use canonical `/roster/handover`, retaining external query compatibility,
  because existing App navigation strips query arguments. Cost: one new supported
  subpath needs router coverage; its regression was observed RED then GREEN.

## Remaining Roadmap and Limits

Stages three through five still require their specifications/plans and execution:
producer readiness/media delivery/crew acknowledgement; reporter/presenter tools;
grouped notifications, private snooze and authorized operational summaries.
The independent whole-roadmap review, merge into `main`, version bump, push and
release remain pending. This verification covers the existing first two stages.

Incoming personal-work summaries currently refresh on mounting/account change;
the handover list has explicit refresh and confirmed detail reads. Local recovery
is device storage, not an encrypted archive or an offline publication facility.
No automatic task, roster, editorial status or live-broadcast changes are added.
