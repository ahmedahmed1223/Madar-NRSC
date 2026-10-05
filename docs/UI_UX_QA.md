# UI, UX and QA review - 2026-10-05

This pass preserves Madar's Arabic RTL newsroom interface. Visual inspection
covered dashboard, news, tasks, programs and settings at 1440, 768 and 390 pixels.
Automated accessibility checks covered the login, 26 main routes and four record
routes in desktop light, desktop dark and mobile light modes.

## Changes

- Shared dialogs now have accessible names, initial focus, Tab wrapping, Escape
  dismissal, focus restoration and overlapping-dialog scroll locks. Headers wrap
  and dialog content scrolls within the dynamic viewport.
- News drafts are written after every field change and again before unloading.
  Embargo fields and unfinished tag input are recovered, empty category/source
  selections are preserved, and pending recovery copies cannot be overwritten.
  Drafts based on older server versions remain available with a review warning.
  Storage failures are visible instead of claiming that a backup succeeded.
- Global search uses the existing Arabic normalization and requires all query
  words across fields. It includes presenters, producers, episode numbers, dates,
  job titles and task assignees. Results refresh when shared data changes.
- Search has a record-type filter, larger controls, mobile viewport constraints,
  clearer result titles and recovery from an empty filtered search. Arrow keys
  leave the native select usable. Counts describe displayed quick results.
- News filters use an unframed toolbar with an accessible search name, live
  result count and a reset action in the empty state. Bulk actions can wrap.
- Touch targets in the main workspace and top bar have a 44px minimum height.
  Caret, selection and scrollbars use the existing palette.
- Sidebar and editor contrast failures were corrected. Category labels use
  theme-aware text while retaining their category-colored dots.
- The lockfile was repaired for cross-platform installation. Existing package
  versions did not change. npm's dry-run clean installation now succeeds.

## Verification

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Production build | Passed |
| npm ci dry run | Passed |
| Arabic/global search unit tests | 5 passed |
| Focus, draft, search, responsive and UX browser tests | 11 passed |
| WCAG A/AA browser checks, light/dark/mobile | 3 passed, no detected violations |
| Full Vitest suite | 187 passed; one intermittent upload ECONNRESET failure |
| Isolated two-factor/upload test file | 11 passed |

The full-suite upload failure also occurred before the UI changes. It is not
claimed resolved. Automated accessibility results are not a guarantee of full
WCAG compliance; manual screen-reader testing and physical-device touch testing
remain useful follow-up checks. Draft protection in this pass is scoped to the
news editor; other business forms have not been migrated to persistent drafts.

## Impeccable

Engine 0.1.5 was installed in the ignored `.impeccable-runtime` project cache.
Its context command and mechanical detector ran successfully. The sidebar
summary accent was corrected. Gray-on-color warnings involving hover rules were
reviewed against the matching hover text styles and the passing contrast checks.
The rich-text blockquote border is intentionally retained as quoted-content
structure, not a decorative card accent.

## Browser testing on restricted Windows hosts

If Playwright cannot terminate its automatically started server, start a fresh
test server separately, then reuse it explicitly:

```powershell
$env:E2E_PORT = '3995'
node tests/e2e/server.mjs
```

In another terminal:

```powershell
$env:E2E_PORT = '3995'
$env:E2E_EXTERNAL_SERVER = 'true'
npx playwright test
```

The test server recreates `tests/e2e/.data`; never point it at a real database.
Stop that server after testing. OpenSSL must be on PATH for TLS delivery unit
tests. The development server uses its separate ignored `data` directory.
