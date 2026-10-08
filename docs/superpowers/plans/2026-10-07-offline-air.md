# Offline Air Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reopen a prepared, encrypted whole-show packet without connection and operate a recoverable local reading/timing session without replaying stale shared broadcast commands.

**Architecture:** A separate offline-air entry point uses IndexedDB/Web Crypto and a narrowly cached service-worker shell. A pure local-session reducer owns timing and journal actions. Authenticated server routes prepare confirmed packets, apply explicitly reviewed drafts and import separate offline-origin audit sessions without mutating shared onAir state.

**Tech Stack:** Existing React/Vite/TypeScript, Web Crypto, IndexedDB, Cache API, Vitest and Playwright; no new runtime dependency.

**Spec:** docs/superpowers/specs/2026-10-07-offline-air-design.md

## Global Constraints

- All scripts/segments come from a confirmed server snapshot, not optimistic client edits.
- Offline editing defaults off; default views remain OPERATIONAL for control and TEXT for studio.
- Prepare only after explicit consent. Encrypt private text; never cache auth/API responses.
- No offline action is queued to the shared onAir collection. Local session imports are separate, append-only and idempotent.
- Existing auth, permissions, edit locks, approval resets and version conflicts still govern online draft application.
- Existing live/remote video links and broadcast hardware output are outside the offline guarantee.
- Tests use isolated data; preserve current production-directory and release edits.

## Review Focus

- Reload during offline operation must restore the selected segment and durable timing (Task 3).
- Quota/download interruption must keep the previous complete packet (Tasks 1/2).
- Reconnect after a colleague progressed the show must not overwrite shared state (Task 5).
- Revoked permissions or changed revisions must block local draft application without losing it (Task 4).
- An incorrect secret, sign-out or database mismatch must not expose another user's packet (Tasks 1/2/5).

## Task 1: Confirmed Packet Contract and Encrypted Persistence

**Files:** Create src/shared/offlineAir.ts, src/services/offlineAirStore.ts, src/server/offlineAir.ts, tests/offlineAirStore.test.ts, tests/server/offlineAir.test.ts. Modify src/server/app.ts.

**Interfaces:** OfflineAirPacket version 1 contains packetId, dbId, userId, preparedAt, shellVersion, show (id/title/ordered segments), baseRows (collection/id/segmentId/v/updatedAt), confirmedState, canOperate and canEdit. It includes a server HMAC proof binding packetId/dbId/userId/showId/preparedAt, signed with a dedicated random 256-bit server-only database metadata key (the existing authentication has no session secret); import verifies this proof and allows records prepared within 30 days. Export offlinePacketError(value): string|null. Export prepareOfflinePacket(db, auth, showId): OfflineAirPacket through GET /api/v1/air-offline/packet/:showId with requireAuth and Cache-Control:no-store. Store functions savePacket(packet, secret), unlockPacket(packetId, secret), listPacketMetadata(), deletePacket(packetId), purgeUser(userId), saveLocalState(packetId, key, state) return Promises; unlock returns packet and an in-memory CryptoKey, never persisted.

- [ ] Write failing tests for packet completeness/order, approved bulletin script handling, read permission, invalid show and authoritative row versions.
- [ ] Implement server snapshot with existing findShow/bulletinAsShow and readiness helpers; strip unapproved copy and expose existing metadata rather than creating fake approvals.
- [ ] Write crypto round-trip/wrong-secret/tampering tests using Web Crypto. Use AES-GCM with random 12-byte IV, PBKDF2-SHA256 with 310000 iterations and random 16-byte salt; local secret must be at least 8 characters.
- [ ] Implement IndexedDB encrypted records keyed by packetId with nonprivate metadata (IDs/timestamp/version, not script/title). Stage and read back a new record without deleting previous complete prepared show packets. A failed write must not remove the prior packet.
- [ ] Test quota/write failure preservation, user/database namespace isolation and metadata listing without plaintext scripts; run focused unit/server tests green and commit.

## Task 2: Offline Shell, Preparation and Lifecycle

**Files:** Create offline-air.html, src/offlineAir/main.tsx, src/offlineAir/OfflineAirApp.tsx, src/offlineAir/offline-air.css, src/build/offlineAirManifest.ts, src/services/offlineAirShell.ts, src/components/onair/OfflineAirPreparation.tsx. Modify vite.config.ts, public/sw.js, src/services/push.ts, src/services/authClient.ts and src/views/OnAirView.tsx. Create tests/e2e/offline-air-preparation.spec.ts.

**Interfaces:** Vite builds app and offlineAir HTML entries. A build plugin emits offline-air-assets.json containing a build identity and the offline entry's recursive JS/CSS dependency URLs. ensureOfflineShell(): Promise<{version:string}> messages the existing service worker and confirms cache read-back before returning. OfflineAirPreparation({showId}) obtains a server packet, consent and secret, prepares the shell and encrypted record, then offers /offline-air.html?packet=<id>.

- [ ] Write browser red tests: prepare a text show, receive a verified ready indicator, go offline and open/reload the dedicated route; no login/server fetch is required to unlock it.
- [ ] Implement a narrow cache allowlist from the same-origin build manifest: offline HTML and its assets only. Reject /api, cross-origin URLs, unsuccessful responses and malformed manifests. Preserve push/notificationclick behavior.
- [ ] Keep complete caches across shell upgrades while old sessions may use them; do not activate a partially cached build. Report unsupported SW/HTTPS or storage failures honestly.
- [ ] Add preparation progress/cancel/error/ready UI, timestamps and remove actions. Abort before packet replacement when preparation is cancelled. Offer export before deleting local unsent work.
- [ ] Make sign-out call purgeUser after a local-work warning, with storage failure surfaced; do not silently retain another account's unlocked session in memory.
- [ ] Notify other same-origin offline-viewer tabs of logout through BroadcastChannel; clear their decrypted state/keys and prove the old user cannot continue reading in an unlocked tab after logout.
- [ ] Verify failed/cancelled preparation, previous-packet retention, push-handler regression, wrong-secret behavior and cross-user access; run tests green and commit.

## Task 3: Recoverable Local Operation and Whole-Show Viewer

**Files:** Create src/shared/offlineAirSession.ts, src/offlineAir/OfflineAirViewer.tsx, src/offlineAir/useOfflineAirSession.ts, tests/offlineAirSession.test.ts, tests/e2e/offline-air-session.spec.ts.

**Interfaces:** createLocalSession(packet, now): OfflineAirSession; reduceLocalSession(session, action, now): OfflineAirSession for START/NEXT/PREVIOUS/PAUSE/RESUME/END; localTiming(session, now) returns current segment and elapsed/remaining. Each event has stable id, sequence and timestamp; persist accepted actions before announcing success. Use existing segment ordering and timing conventions.

- [ ] Write reducer red tests for start/navigation/pause/resume/end, bounds, zero durations, stable journal order and reload restoration.
- [ ] Implement local operation only when packet.canOperate; otherwise provide whole-show reading/navigation without local control. Clearly label local operation and never import apiService/DataStore mutation paths into the viewer.
- [ ] Detect a device-clock jump beyond 120 seconds against the running monotonic reference; hold timing and offer explicit correction. Persist wall-time checkpoints; on reopening request review for a backwards wall clock.
- [ ] Add ordered full-show navigation, operational/text views, font controls, fullscreen, local status and keyboard guards. Empty/video-only text segments show an honest empty state, never the previous story's script.
- [ ] Browser test actual offline mode, reload/reopen, every segment, pause/resume/end and journal recovery; assert shared server onAir is unchanged after reconnect. Verify 390px/1440px keyboard/layouts, then commit.

## Task 4: Optional Local Script Drafts and Explicit Online Application

**Files:** Create src/offlineAir/OfflineScriptDrafts.tsx, src/server/offlineAirDrafts.ts, tests/server/offlineAirDrafts.test.ts. Modify src/types/index.ts, src/shared/settings.ts and src/components/settings/AirDisplaySettings.tsx. Add tests/e2e/offline-air-drafts.spec.ts.

**Interfaces:** allowOfflineScriptEdits?: boolean defaults false, server-validated. Local drafts contain segmentId, downloaded baseline, edited text and base row version. GET /api/v1/air-offline/draft-target/:collection/:id returns the permitted current row. POST /api/v1/air-offline/apply-draft accepts userId/dbId/collection/id/segmentId/baseV/script and uses SyncService.apply with existing lock/version policies; it is never an offline queue. For bulletinStories change only script; for episodes replace only the matching rundown segment's scriptText in the current row, preserving all other segment/episode fields. Reject missing or ambiguous segment IDs.

- [ ] Write failing tests for default-off, enable/disable validation, editable-versus-read-only packets, preserved local draft after reload and compare/undo/export.
- [ ] Implement encrypted draft persistence on explicit save, pending/error status and a local-only edit indicator. Editing a local draft does not change the immutable downloaded baseline.
- [ ] On reconnect, require current authentication, permission and explicit comparison/confirmation. Acquire the ordinary edit lock through the existing sync editLocks contract; apply only if the target base version still matches, and release only that owned lock after completion.
- [ ] Use existing story/episode policy and stamping for successful application; approval reset behavior is preserved. Changed/deleted targets, revoked permissions and another owner's lock return clear errors without deleting the draft.
- [ ] Run server/browser permission/conflict/lock/recovery tests green and commit.

## Task 5: Explicit Reconnection and Offline-Origin As-Run Import

**Files:** Create src/server/offlineAirSessions.ts, src/offlineAir/OfflineReconnectPanel.tsx, tests/server/offlineAirSessions.test.ts. Modify src/shared/collections.ts, src/server/policy.ts, src/server/sync.ts, src/services/api.ts and src/components/onair/AsRunPanel.tsx. Add tests/e2e/offline-air-reconnect.spec.ts.

**Interfaces:** offlineAirSessions is append-only server-imported reporting data, not shared broadcast control. POST /api/v1/air-offline/sessions imports {sessionId,packetId,dbId,showId,preparedAt,proof,events} after current on-air permission and packet-proof verification; GET /api/v1/air-offline/state/:showId returns current permitted shared state for comparison. Imported record actor/time are server-stamped; client action times are explicitly reported offline-origin values. Ordinary collection sync may not create or alter these server-imported records.

- [ ] Write failing tests for unauthorized import, wrong database/user, invalid actions/order, duplicate session ID and different-content retry. Bound journals to 2000 events and imported JSON to 1MB.
- [ ] Implement idempotent imports: same ID/same canonical content returns the existing result; different content is rejected. Import never calls setOnAir or changes an existing As-Run entry.
- [ ] Show current server state versus local journal on reconnection, with explicit import/report and resume-current-server options. No reconnect path automatically replays local control actions.
- [ ] Display offline-origin records distinctly in AsRunPanel, preserving the source/actor/reported timestamps.
- [ ] Test two-operator divergence, ended/deleted shows, revoked permissions, sign-out clearing and retry idempotency; run tests green and commit.

## Task 6: Stability, Accessibility and Final Regression

**Files:** Create docs/OFFLINE_AIR_VERIFICATION.md; modify src/content/help.ts, src/content/whatsNew.ts and .github/workflows/ci.yml.

- [ ] Document preparation-before-outage, device secret/storage/privacy, local-versus-shared operation, editing conflicts, exports and unavailable remote video/hardware limitations.
- [ ] Exercise real browser offline mode and server-only outage, storage failures, shell upgrade, packet refresh failure, wrong secret, reload/reopen, all-segment display, edit recovery and reconnect import.
- [ ] Run keyboard/axe/overflow checks at 390px/1440px in both themes; inspect screenshots and verify that banners do not cover air controls or text.
- [ ] Add critical specs to CI and run `npm run check` and the full isolated Playwright suite. Record exact tests and failures, not a universal uptime guarantee.
- [ ] Obtain the required fresh-context final review, address important findings with red/green tests, and report remaining limitations. Merge/push requires user authorization.

## Execution Handoff

Recommend native execution in this chat, preserving the chosen method. The implementation plan must be reviewed before this separate subsystem is coded; no offline-readiness claim is made for the current app yet.
