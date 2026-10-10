# Daily Role UX: Roadmap and Phase One Design

Date: 2026-10-10
Status: Phase one implemented and verified; later roadmap stages remain required
Branch: codex/daily-role-ux

## Intent

Improve repeated newsroom work across customized roles on desktop and mobile:
find the next useful action, resume interrupted work, and distinguish pending
work from completed work. The user approved the complete feature group in
stages. This document specifies the first stage and preserves the remaining
stages as a roadmap, not as already implemented capabilities.

Success means fewer navigation steps without weaker permissions, misleading
save confirmations, automatic editorial decisions, or changes to live broadcast.
Existing Arabic RTL UI, keyboard conventions, draft protection, and offline-air
behavior remain intact.

## Existing System

- DashboardView already embeds MyWorkPanel. Extend it rather than add another
  dashboard or a second personal work page.
- MyWorkPanel already aggregates authored news, reviews, department requests,
  sent requests, tasks, episodes, bulletin work, diary, bookings, and mentions.
- useNewsListPreferences already saves page size and columns per user locally;
  preserve these preferences and their existing storage key.
- Collection sync uses row versions and optimistic concurrency. Server RBAC is
  authoritative. Default role names do not define access for customized roles.
- Notifications and notification preferences already exist. Do not introduce a
  second delivery system.

## Selected Approach

Build vertical stages on existing flows. A replacement dashboard would duplicate
established work queues; a new universal workflow engine would add unnecessary
contracts. Small typed queue selectors, existing navigation callbacks, and
private preferences provide a narrower first stage.

## Approved Roadmap

| Stage | Deliverables | Boundary |
| --- | --- | --- |
| 1 | My Work Today, named filters, list context restoration, disabled-action explanations in touched flows | Detailed design below |
| 2 | Review queue ordered by broadcast deadline; explicit shift handover and acknowledgement | Separate spec and plan before implementation |
| 3 | Producer preparation checklist; media request delivery queue; crew shift acknowledgement | Reuse episodes, readiness, requests, roster, bookings |
| 4 | Reporter mobile submission with upload progress/retry; presenter personal reading preferences and offline preparation freshness | Reuse uploads, drafts, prompter and offline-air contracts |
| 5 | Actionable grouped notifications and private snooze; admin exception summary; authorized approved-material viewer summary | Reuse notifications and restricted operational APIs |

Each later stage receives its own written specification, implementation plan,
verification, and review. Their inclusion here does not authorize unspecified
server contracts. All remain in the approved feature scope.

Roadmap invariants:

- Published handovers contain references and bounded notes, not copied hidden
  news content. Acknowledgement records the authenticated actor server-side.
- Review deadlines come from actual linked broadcasts; unknown deadlines are
  clearly labelled and never fabricated. No automatic approval or submission.
- Reporter retry preserves text and uses existing upload security. Background
  or resumable chunk uploading is not promised by this roadmap.
- Presenter preferences never resume playback or send live control commands.
- Snoozing affects the user's display only; it does not change delivery consent
  or silently hide urgent operational alerts.
- Viewer summaries never widen access; admin exceptions require existing
  operational permissions. No unauthorized bulk offline cache is added.

## Phase One Scope

### Personal Work Surface

Keep the existing MyWorkPanel entry point. Organize its existing queues into
compact sections with stable counts, a native button/link for each action, and
an explicit empty state. Show the actionable items before supplementary items.
Do not hide tasks merely because a user has a different default role name.

Offer local section visibility and ordering preferences. Mandatory operational
warnings cannot be hidden. Preferences are keyed by authenticated user and do
not modify team configuration. Default order prioritizes returned authored work,
pending review, assigned tasks, department requests, and upcoming preparation.

Rows show the item's title, status, owner when authorized, due time when known,
and one clear next action. Existing priority/order semantics remain unchanged
unless this specification explicitly changes them. Full deadline-aware review
ordering belongs to stage two.

Use the configured station timezone for the day boundary and upcoming windows,
through existing timezone utilities. Invalid configuration follows the existing
system fallback. Freeze the evaluation time per render/update so items do not
receive inconsistent day classifications in one calculation.

### Navigation and Resume

Use existing exact-entity navigation wherever supported. For routes that only
support opening a general list, provide a validated entity-focus parameter and
consume it after the list has loaded. Unsupported, deleted, or inaccessible
targets lead to the authorized list with a neutral unavailable message.

Preserve list filters, selected tab, page, and scroll anchor per user/device
for news and personal-work lists only in phase one. Restore on return to the
list, not by redirecting the user on application startup. Prefer an item ID
anchor; clamp pagination and fall back to the top if the anchor disappears.
Never reopen a modal, replay an action, auto-submit a draft, or restore playback.

Store filter metadata only, not article bodies, private messages, attachments,
or authentication data. Logout/account switch must not expose another user's
context. Invalid or obsolete storage values fall back to defaults.

### Named Saved Filters

Phase one named filters apply to the news list. Existing page-size/column
preferences retain their current behavior. My Work section preferences are
local and separate from named news filters.

Create a private server-owned collection for saved news filters, using the
existing sync/version model. Each record contains: id, ownerId, schemaVersion,
name, typed filter definition, pinned, createdAt, updatedAt. The server sets
owner and timestamps and enforces ownership for reads and all mutations.
Generic sync and bootstrap must not expose another user's records. Admin access
does not implicitly allow reading private filters.

Names are trimmed, nonempty, at most 80 characters. Limit each user to 30 saved
filters. Definitions use an allowlist of supported news-list filter fields and
bounded values. Search text is at most 200 characters. No executable queries,
arbitrary URLs, script, or embedded content. Invalid fields are rejected with a
field-level error; old unknown schema versions are not applied silently.

Pinned filters appear in a compact accessible picker; overflow uses a menu.
Create, rename, update, pin, and delete require confirmed persistence. Keep the
previous saved version on failure and offer retry. A stale edit/delete receives
a conflict message and requires reload/review; do not overwrite newer changes.

Applying a filter never grants permission or changes ownership. Missing category
or user references are marked unavailable and can be removed; do not silently
broaden the query. Filters store no result rows and grant no offline content
access. Without connection, previously available local filter definitions may
be applied to currently authorized loaded data, but server mutations are disabled
with an explanation; do not claim offline saves were confirmed.

### Disabled Actions and Interaction

Explain disabled actions in the touched work and filter controls using short
visible Arabic text where needed and accessible descriptions. Distinguish lack
of permission, connection loss, version conflict, and required fields without
revealing hidden identities or content. Server authorization still decides.

Use native controls, visible keyboard focus, logical RTL tab order, Escape to
close menus/dialogs, and return focus to the trigger. Global shortcuts must not
fire while typing or during confirmation dialogs. No new shortcut conflict.

Desktop uses compact rows and constrained columns. At 390px, rows wrap metadata,
actions remain reachable, and filter management does not cause horizontal page
overflow. Counts and loading states reserve space to avoid layout jumps.

## Architecture and Failure Handling

- Extract focused pure selectors only for queue calculations actually changed;
  do not refactor unrelated collections or dashboards.
- Use a typed shared filter sanitizer/validator for client and server, with
  stricter server enforcement of ownership, size, timestamps and versions.
- Reuse existing confirmed-write and notification patterns. An optimistic local
  result is not a successful save until acknowledged.
- Separate private preference records from public workflow collections.
- Storage failure leaves the current visit usable and shows one concise warning.
- Revalidate access when opening a referenced item. Revoked permissions remove
  inaccessible items and do not restore stale cached content.

## Acceptance and Verification

1. Existing dashboard work items remain available for each applicable permission
   combination, including customized roles and multi-department responsibilities.
2. A newsroom day is identical on devices with different local timezones;
   midnight and daylight-saving boundaries have deterministic tests.
3. Returning from a news item restores filters/tab/page/anchor; a deleted anchor,
   empty result, malformed storage, and account switch recover safely.
4. Saved-filter CRUD and pinning work after reload. Cross-user bootstrap/read/
   write/delete attempts, forged owner/timestamps, and unsupported query fields
   fail on the server. Test both dedicated and generic sync paths.
5. Concurrent writes and retry do not silently overwrite newer preferences or
   display a false success. Connection loss preserves the current working view.
6. Exact-item actions open the correct accessible target; missing or inaccessible
   targets do not leak data or trap the user.
7. Keyboard-only journeys cover menus, filter management, focus restoration and
   disabled-action explanations. Existing save/submit shortcuts retain behavior.
8. Serial browser tests at 390px and 1440px, light/dark and Arabic RTL, verify
   overflow, focus, empty/loading/error states and representative roles.
9. Run focused unit/server tests, TypeScript/build, then the affected browser
   journeys. Record actual results and residual gaps before release claims.

## Explicit Exclusions for Phase One

No shift-handover implementation, live broadcast behavior changes, new upload
protocol, notification transport, cross-device scroll synchronization, global
dashboard redesign, dependency replacement, or automatic editorial actions.
No release bump, main merge, remote push, or live-data destructive testing is
part of writing this specification.

## Review Outcome

Self-reviewed for scope, duplicate functionality, ownership, offline-save claims,
timezone consistency, conflict handling, and measurable acceptance criteria.
No unresolved placeholders. User approved the written specification and phase-one
plan. Phase one is implemented with independent review fixes; evidence is recorded
in docs/releases/daily-role-ux-phase-one-verification.md. Stage two has a separate
written specification awaiting review. No full-roadmap release is claimed.
