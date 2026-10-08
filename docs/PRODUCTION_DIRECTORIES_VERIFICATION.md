# Production Lists and Air Display Verification

Approved spec: docs/superpowers/specs/2026-10-07-production-directories-design.md.
Plan: docs/superpowers/plans/2026-10-07-production-directories.md.
Execution: native in this chat; live data stays untouched by tests.

## Progress

- Directory validation/API: focused tests red, then 5/5 green (including air-default validation).
- Settings lists: add/edit/deactivate/duplicate and studio creation browser journey passed.
- Editorial name fields: red browser test confirmed missing suggestions; implementation, TypeScript and browser retest passed.
- Air display/default settings: implemented; implicit select-label issue fixed, browser retest passed including text-only air.
- Settings, historical/free-text names and control/studio defaults passed focused browser journeys. Prompter checks passed at 390px/1440px.
- Latest `npm run check`: TypeScript, 259 unit/server tests and production build passed. Complete browser regression results are recorded in docs/OFFLINE_AIR_VERIFICATION.md.

## Rulings

- Ruling: reuse this checkout on a dedicated branch because the live server uses
  it; preserve the pre-existing 3.22.0 release edits, excluded from slice commits.
- Ruling: keep the existing Tailwind/React design system without adding a UI
  library; introducing a new library would contradict this spec's no-dependency
  constraint and existing application conventions.
- Ruling: use OPERATIONAL as the station default for control-room air mode and
  TEXT for the presenter studio screen. A screen-level switch changes only
  presentation, not approval, segment timing or broadcast state. This follows
  the user's latest request for configurable defaults. Existing READER types
  require no video; clip-based types keep their clip readiness requirement.
- Ruling: Episode already models presenterName/directorName but creation did not
  expose those inputs. Add them to its existing creation form and recovery payload
  to make directory choices usable; no new entity relationship or account ID.
- Ruling: full offline reopening/editing/reconciliation is a separate approved
  architectural spec and plan, not an unverified claim about the current display.
