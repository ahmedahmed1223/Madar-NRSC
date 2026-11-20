# Daily Role UX Stage Four Implementation Plan

**Goal** Improve reporter attachment upload, private presenter reading settings, and local air snapshot freshness in the existing interfaces.

**Architecture** Reuse the shared media picker and authenticated XHR transport, a local per-account reading preference hook, and offline packet metadata with current synchronized row versions.

**Tech stack** React, TypeScript, IndexedDB, Vitest and Playwright.

**Spec** `docs/superpowers/specs/2026-11-20-daily-role-ux-stage-four-design.md`

- [x] Cover measured and indeterminate XHR progress, field form retry and explicit attach in `tests/client/mediaUpload.test.ts` and `tests/e2e/field-media-upload.spec.ts`. Expose the chooser and queue from `AttachmentsPanel`/`MediaPicker` and keep the current upload and media registration safeguards.
- [x] Cover account-keyed, bounded settings with `tests/client/readingPreferences.test.ts`. Use the shared client settings in `TeleprompterModal` and `OfflineAirApp`, with the prompter reopening paused. Extend the existing prompter browser journey to check restored settings.
- [x] Cover matching, changed and unknown snapshot status in `tests/offlineAirFreshness.test.ts`. Extend `offlineAirStore` metadata with a fingerprint of existing packet references and timing, compare synchronized data in `OfflineAirPreparation`, and show the preparation timestamp in `OfflineAirApp`.
- [ ] Run focused suites, TypeScript, and affected browser journeys. The coordinating agent runs the shared build and browser tests.
