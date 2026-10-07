# Production Directories in Settings

## Intent and Scope

The user chose the recommended independent production lists, not login-account
administration. Add a Production Lists section to Settings for presenters,
directors and studios. These lists must supply actual editorial form choices,
not just an isolated settings screen. Preserve existing records and permissions.

This is an architectural extension: shared reference data and several form
consumers change together. This spec requires review before an implementation
plan and product changes. The unrelated local 3.22.0 release edits are preserved.

## Decisions

- Prefer an independent people directory over creating fake user accounts.
- Reuse existing resources of kind STUDIO rather than create a second studio
  directory with different availability and booking identities.
- Do not add arbitrary custom fields, login administration, availability scheduling
  for people, producer lists or channel lists in this slice.

## Data and Permissions

- Add a productionPeople collection through the existing SQLite entity registry
  and synchronized browser mirror. Each row has id, name, roles (PRESENTER and/or
  DIRECTOR), active, optional notes, createdAt and updatedAt.
- A person may have both roles. No relationship to users or permission inheritance
  is implied. Do not copy private user contact information into the directory.
- Read names for authenticated editorial workflows; restrict people mutations to
  system.settings. Validate trimmed names of 1-120 characters, known nonempty
  unique roles, a boolean active and notes of at most 2000 characters on the server.
  Server-stamp timestamps; do not trust client-supplied creation/update times.
- Reject duplicate normalized names within the people directory, excluding the
  current row. IDs remain stable when names or roles change.
- Studio management remains under resources.manage. Show existing studio
  resources in Settings and preserve resource/bookings policies; do not grant
  settings administrators new resource powers implicitly.
- No destructive removal of people: deactivate instead. Existing studio deletion
  flows are not exposed by this new settings section; use existing resource
  management for studio lifecycle operations.
- Use existing audit and row-version conflict handling. No automatic import or
  migration rewrites live records on deployment.

## Settings Experience

- Add searchable Production Lists navigation alongside existing settings sections.
- Use tabs for presenters, directors and studios; show compact searchable rows
  with name, active status and explicit edit actions, with mobile-friendly layout.
- Presenter/director forms support name, role checkboxes, active toggle and notes.
  Search and an inactive filter make historical entries discoverable.
- Studio entries use the existing resource form contract and permission checks;
  offer name and the supported resource fields, not a separate data model.
- Save waits for server acceptance; failures/conflicts keep input visible. Use
  existing draft recovery, keyboard behavior and focus restoration patterns.

## Form Integration and Compatibility

- Supply active presenters to program, episode, bulletin and bulletin-template
  presenter fields, and to the bulletin-story anchor field.
- Supply active directors to existing episode director fields. Do not invent
  director fields on screens whose saved entities have none.
- Supply existing active STUDIO resource names to program, episode, bulletin and
  bulletin-template studio fields.
- Keep free-text entry for legacy and exceptional names; lists provide consistent
  suggestions rather than mandatory reassignment of older records.
- Retain existing user-derived presenter suggestions as a deduplicated fallback,
  excluding any normalized name already managed in the directory, including
  inactive entries so account suggestions cannot undo directory deactivation.
  Do not repurpose presenterId, which currently refers to a login user, as a
  directory-person ID. This slice keeps existing saved name fields unchanged.
- A directory rename affects future suggestions, not names already saved in
  programs, episodes, stories or templates. Disabled entries stay visible when
  already selected but are not offered as new active choices.
- Studio suggestions do not reserve a resource or bypass existing booking and
  schedule-conflict rules.

## Acceptance and Verification

- Server tests cover validation, unauthorized writes, duplicate names, immutable
  identity, deactivation and preservation of existing studio permissions.
- Browser journeys add/edit/deactivate a presenter and a director, save and reload,
  then use the active suggestions in their existing editorial fields.
- Verify that deactivation and rename leave historical and free-text names intact,
  and that rejected/conflicting saves keep form values without success messages.
- Exercise keyboard navigation, recovery, empty/search states and accessibility
  at 390px and 1440px in both themes.
- Run typecheck, unit/server tests, production build and focused browser tests on
  isolated test data. Never reset or seed the live database for testing.

## Follow-On Gate

After the user approves this written spec, prepare a concrete implementation plan
using the repository's existing APIs, resource forms and test helpers. Execute
only after that plan's review and execution choice. Version bump edits remain
outside this spec's commit; integration/push requires the applicable user request.
