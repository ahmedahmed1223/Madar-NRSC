# Settings Verification

Date: 2026-10-06

## Implemented

- Settings search, dedicated editorial defaults, device appearance preferences and read-only runtime status.
- Explicit station/device time basis; changing the station timezone requires confirmation.
- General settings wait for the server acknowledgement before displaying success.
- A rejected write preserves entered values. Recovery drafts are scoped to the signed-in user.
- Save/cancel state, pending changes, mobile navigation and 44px actions.
- Shared client/server validation of identity, timezone, durations, priority and date/time options.
- Mandatory audit logging and server-owned accepted-setting changes with previous/new values.
- Editorial default priority and breaking duration apply to new stories and breaking actions.
- Scheduled publication also reads the configured breaking duration.
- Runtime information is permission-protected and excludes paths, destinations and credentials.
- Per-user, per-browser news list preferences: 10/25/50/100 results and optional category,
  priority, author and update columns. Headline, status and actions remain available.
- Shared text-only news templates with duplicate validation, recovery drafts, confirmed saving,
  confirmation before replacing copy, and undo that protects subsequent edits.
- Programme structure templates now wait for acknowledgement and show failures distinctly.
- Concurrently changed news templates cannot be overwritten from an older open form.

## Verified

- Type checking and production build succeeded.
- 232 unit/server tests passed.
- 19 focused browser tests passed: customization, settings, desk workflows and newsroom UX.
- The accessibility test in that run covered four settings sections, two sizes and both themes (16 checks).
- Screenshots inspected at desktop/mobile sizes. No horizontal page overflow in focused checks.
- Tokyo timezone changes the displayed clock and newly entered event time, persists after reload.
- Server tests cover rejected settings, permissions, audit diffs and scheduled breaking expiry.

## Boundaries

Appearance preferences are device-local, not synchronized per-user preferences across devices.
Runtime security, retention and backup destination values remain deployment configuration;
the interface displays their state but does not modify environment variables or expose secrets.
Runtime status describes configured backup destinations, not proof of a successful remote recovery drill.
Column preferences are stored per user on the current browser, not synchronized across devices.
Programme templates continue to belong to programmes; they are not duplicated in station settings.
Configurable approval workflows and additional deployment security controls remain future work;
this change does not add cosmetic toggles for features without an implementation.
