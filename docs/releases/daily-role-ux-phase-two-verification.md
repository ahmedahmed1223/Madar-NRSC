# Daily Role UX Phase Two Verification

Date: 2026-10-11
Branch: codex/daily-role-ux
Status: Final browser verification in progress; not a release

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

- Final `npm run check`: 79 test files / 361 unit and server tests passed;
  TypeScript and production build passed. The first attempt could not find
  OpenSSL for an existing delivery test. Adding the already installed Git OpenSSL
  directory to this process's PATH resolved it; no dependency was installed.
- Focused post-fix browser run: 3/3 passed for the lost-save/later-edit case,
  help content and deterministic stalled-delete/lost-acknowledgement simulation.
- The first broad browser run passed 67/69. A stale hardcoded help article count
  and a held Playwright route released by unrouteAll caused the two failures.
  Help now checks the actual article set and the new guide; the cancellation
  fixture aborts its held route and verifies no deletion reached the server.
- Final serial browser run and clean preview checks: pending at this writing.

## Hardening Findings Addressed

- Keyboard focus returns to the actual opener after modal replacement/closure.
- Mobile error feedback scrolls into view without moving input focus offscreen.
- A refreshed uncertain create is reconciled by stable ID rather than repeated.
- A second confirmed save updates the recovery baseline before publication.
- A restored create conflict can explicitly load the current server version.
- Edits made after stopping an uncertain save are never marked as saved merely
  because the older write was confirmed. Fields remain local until explicit
  server-version review; the user confirms replacement.
- Review source arrays require explicit collection permissions before selectors
  consume them, rather than relying on permissive generic policy defaults.

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
The independent whole-branch review, verified main integration, version bump,
push and release remain pending until all stages are complete.

Incoming personal-work summaries currently refresh on mounting/account change;
the handover list has explicit refresh and confirmed detail reads. Local recovery
is device storage, not an encrypted archive or an offline publication facility.
No automatic task, roster, editorial status or live-broadcast changes are added.
