# Production Directories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage production people and existing studios in Settings and supply them to editorial fields without changing historical records or account permissions.

**Architecture:** Add productionPeople through the existing entity/sync pipeline. A focused settings component owns list management; a shared suggestion helper supplies existing name fields. Studio management reuses resources of kind STUDIO and resources.manage.

**Tech Stack:** React, TypeScript, existing SQLite entity store, Vitest and Playwright; no new dependency.

**Spec:** docs/superpowers/specs/2026-10-07-production-directories-design.md

## Global Constraints

- People are independent of login users; never put directory IDs in presenterId.
- Only system.settings may mutate people. Existing resources.manage governs studios.
- Names are trimmed, 1-120 characters; roles are nonempty unique PRESENTER/DIRECTOR; active is boolean; notes are at most 2000 characters.
- Server-stamp timestamps; preserve row-version conflicts and audit handling.
- Deactivate people instead of deleting; no studio deletion from this settings section.
- Preserve saved/free-text names. Do not import or rewrite live data automatically.
- Preserve the unrelated local 3.22.0 version edits; isolated tests must not reset live data.

## Review Focus

- A disabled person sharing a user name must not return through fallback suggestions (Task 1).
- Arabic spacing/diacritics and case variants must not defeat duplicate checks (Task 1).
- Rename/deactivation must leave older selections unchanged (Task 3).
- A settings administrator without resources.manage must not gain studio-write access (Task 2).
- Rejected/concurrent saves must retain fields and not announce success (Task 2).

## Task 1: Validated Directory and Suggestion Contract

**Files:** Create src/shared/productionPeople.ts, tests/productionPeople.test.ts, tests/server/productionPeople.test.ts. Modify src/shared/collections.ts, src/server/policy.ts, src/server/sync.ts, src/services/api.ts.

**Interfaces:** Export ProductionPerson { id, name, roles: ProductionRole[], active, notes?, createdAt, updatedAt }; ProductionRole = 'PRESENTER' | 'DIRECTOR'. Export normalizeProductionName(name: string): string, productionPersonError(value: unknown): string | null, productionNameSuggestions(people: ProductionPerson[], role: ProductionRole, fallback: string[]): string[]. API methods getProductionPeople(): ProductionPerson[] and saveProductionPerson(data: Partial<ProductionPerson>): ProductionPerson use the existing synchronous mirror; callers await dataStore.awaitWrite('productionPeople', id).

- [ ] Write failing unit tests: reject empty/overlong names, unknown/duplicate/empty roles, invalid active and notes >2000; normalize Unicode NFKC, trim/collapse whitespace, remove Arabic tatweel/diacritics and lowercase for duplicate comparison without altering displayed names.
- [ ] Write failing server tests: unauthorized mutation and deletion rejected, normalized duplicate rejected excluding current row, client timestamps ignored, optimistic-version conflict retained.
- [ ] Run `npx vitest run tests/productionPeople.test.ts tests/server/productionPeople.test.ts` and record the red result.
- [ ] Implement the collection, validation, server permission/read policy, duplicate checks and timestamps; use existing sync and audit patterns rather than new endpoints.
- [ ] Implement suggestions sorted by displayed name: active matching-role people plus normalized-deduplicated fallback names not present anywhere in the directory, including inactive/nonmatching-role rows.
- [ ] Test inactive matching user fallback exclusion, two roles, empty directory fallback and idempotent updates; run the same focused tests green.
- [ ] Commit only this slice's source/tests, not the unrelated release files.

## Task 2: Production Lists Settings UI

**Files:** Create src/components/settings/ProductionListsSettings.tsx, tests/e2e/production-lists-settings.spec.ts. Modify src/views/SettingsView.tsx. Consume src/shared/planning.ts Resource and existing apiService.getResources(includeInactive), saveResource(data).

**Interfaces:** ProductionListsSettings({ currentUser }: { currentUser: User }) uses live productionPeople/users/resources data. The component exposes presenter/director/studio tabs and existing FormPage/useFormDraft conventions; studio writes use awaitWrite('resources', id).

- [ ] Write browser tests for add/edit/reload/deactivate people, name/role validation and duplicate feedback; keep each case on isolated test data.
- [ ] Add a searchable Production Lists section without enlarging SettingsView with form implementation; searchable rows and active/all filters use accessible controls on desktop/mobile.
- [ ] Implement name, role checkboxes, active toggle and notes form; stable retry ID, draft recovery, pending state, accepted-write-only success and blocked close during save. Preserve fields after rejection/conflict.
- [ ] Implement studio name, location, notes and isActive using existing STUDIO resource records; read-only display without resources.manage and no delete action. Never replace system.settings checks with a resource permission bypass.
- [ ] Exercise settings-admin-without-resources.manage via UI and direct sync; prove no unauthorized resource creation/update.
- [ ] Test rejected/conflicting save, immediate reload recovery, empty/search states, Escape/focus return, and Ctrl/Cmd+S form save; use existing dialog guards.
- [ ] Build, then run `npx playwright test tests/e2e/production-lists-settings.spec.ts` green and commit the slice.

## Task 3: Wire Existing Editorial Name Fields

**Files:** Modify src/views/ProgramsView.tsx, src/views/EpisodesView.tsx, src/views/BulletinsView.tsx, src/views/BulletinRundownView.tsx, src/components/bulletins/StoryEditor.tsx; create src/components/common/ProductionNameField.tsx and tests/e2e/production-name-fields.spec.ts. Inspect the existing episode metadata editor before placing the director field integration; record the actual owning file in the execution ledger.

**Interfaces:** ProductionNameField({ id, label, value, onChange, suggestions, multiple? }) supplies an accessible name input and native suggestions. It retains arbitrary current values; multiple presenter fields keep existing comma-separated storage. Suggestion consumers use Task 1's helper and existing resources filtered to STUDIO/isActive/not deleted.

- [ ] Write failing field-integration tests: active presenter available in programs, episodes, bulletin/template and story anchor fields; active director in the existing episode director field; active studio in existing studio fields.
- [ ] Locate the existing director metadata field via source search, then apply the component to that owner; do not add a new director field merely to satisfy a test.
- [ ] Add live directory/resource subscriptions to consumers; preserve existing name strings and user fallback without reusing presenterId for directory identity.
- [ ] Verify comma-separated bulletin anchors remain intact and native keyboard suggestions do not unexpectedly submit or navigate the page.
- [ ] Test historical names remain unchanged after rename/deactivation, and unknown free text saves/reloads unchanged; prove no booking is created by selecting a studio suggestion.
- [ ] Run `npx playwright test tests/e2e/production-name-fields.spec.ts`, the existing form-draft tests and the editorial team journey green; commit the slice.

## Task 4: Accessibility, Documentation and Regression

**Files:** Modify src/content/help.ts, src/content/whatsNew.ts, .github/workflows/ci.yml; create docs/PRODUCTION_DIRECTORIES_VERIFICATION.md.

- [ ] Run settings and name-field checks at 390px/1440px in both themes; axe must report no A/AA violations on new surfaces, no page overflow and reachable primary actions. Inspect screenshots.
- [ ] Update help with independent-directory versus user-account distinction, permissions, free-text compatibility and deactivation behavior; append notes to the pending 3.22.0 entry without another version bump.
- [ ] Add focused browser specs to the CI critical paths; document exact executed coverage and remaining limitations.
- [ ] Run `npm run check` with Git OpenSSL on PATH and the complete Playwright suite against isolated data; fix failures before completion.
- [ ] Perform the required fresh-context final review using executing-plans, then report real results. Do not merge/push this new work without the applicable user instruction.

## Execution Choice and Separate Air-Display Request

Native execution in this chat is recommended: the slices share validation/API and settings contracts. This written plan must be reviewed before product implementation.

The later air-display request is a separate bounded change, not a directory requirement. Proposed in-chat design: an operational/text view selector for OnAirView and StudioScreenView, showing the current saved script through existing bulletinAsShow mapping and following the controlled current segment. Keep approvals and clip requirements for clip-based story types. Text-only READER stories need no video. Review that design separately before implementation; do not introduce video streaming or hardware output routing.
