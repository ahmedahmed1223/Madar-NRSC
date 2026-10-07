# Editorial Workflow Execution Ledger

Spec and plan approved for native implementation, merge and push on 2026-10-07.
Branch: codex/editorial-workflow. Live application data must not be reset.

## Progress

- Task 1 confirmed writes/recovery: implemented; rejected-write and draft browser checks passed.
- Task 2 safe source comparison: implemented, including explicit replace and protected undo.
- Task 3 readiness/server enforcement: implemented; configured chains require recorded signoffs.
- Task 4 assignment/manager queue: implemented using existing tasks and accepted-write notifications.
- Task 5 anchored review threads: implemented with server permissions and immutable reply records.
- Task 6 mobile/accessibility: implemented; 390/768/1440px and theme checks passed; screenshots inspected.
- Task 7 full-team acceptance journey: passed through revision, task completion, two signatures,
  live broadcast, confirmed end and a closed As-Run entry.
- Keyboard extension: bounded design explicitly approved on 2026-10-07; keyboard browser checks passed.

## Rulings

- Keep the current checkout on a dedicated branch instead of creating another
  worktree: the user explicitly authorized execution/integration here and the
  live development server uses this checkout. No live database test writes.
- Ruling: keep comparison inside StoryEditor rather than extract a new component;
  its replacement/undo/recovery state is local to that editor. No diff dependency is
  needed for side-by-side plain text. The cost is a larger editor component.
- Ruling: the anchor's baseVersion is the target updatedAt revision, while row versions
  still guard sync writes. Creation must quote the saved revision, not unsaved content.
- Ruling: legacy APPROVED stories without an explicitly configured approval chain
  retain compatibility. Explicit chains require every stored step signature; adding
  a new required step blocks air until signed. External video playback/factual
  accuracy cannot be guaranteed by metadata readiness checks.
- Ruling: bulletin reads follow the existing authenticated bulletin collection policy;
  no invented bulletins.view permission is introduced. Posting still requires the
  existing bulletin edit/approve permissions.
- Ruling: use one final fresh-context reviewer, as required by executing-plans.
  Five Important findings (author resolution, chain verification, retry identities,
  and pending approval queue visibility) were addressed. No implementer delegation was used.
- Keyboard design: Ctrl/Cmd+S saves, Ctrl/Cmd+Enter submits the relevant editorial
  action, replies consume their own shortcut, Escape closes the top page/dialog and
  returns focus. Global shortcuts ignore editing targets, composition, repeat and
  active forms/dialogs. Remove undocumented/nonfunctional navigation shortcuts.

## Verification

- Latest completed check: typecheck, 244 unit/server tests in 44 files, production build.
- Final isolated browser regression: 91/91 tests passed in 8.1 minutes, including
  keyboard navigation, source comparison, full-team acceptance and accessibility.
- Earlier failures exposed test selector/cleanup issues, a nonexistent bulletin
  permission, a client/server partial-signoff mismatch, early Escape focus timing,
  and an end-of-air assertion that did not wait for confirmation. All were corrected
  before the final complete regression run.
- Test data stays in tests/e2e/.data, separate from the live database.

## Coverage Boundaries

- Readiness checks stored metadata, not factual accuracy or external video playback.
- Browser keyboard automation uses Windows Control keys; Meta bindings are implemented
  but have not been exercised on physical macOS hardware.
- Existing embargo, lock, rejected-write and copy tests remain in the regression suite.
  Exhaustive network-delay/partial-copy retry combinations are not separately covered
  by the new team acceptance test.
- The test plan remains a specification checklist, not a claim that every individual
  scenario has independent automated coverage. This ledger records executed evidence.
