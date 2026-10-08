# Reliable Offline Air Experience

## User Intent

The user expanded the initial open-page resilience request to a complete offline
air experience, with stability and usability as priorities. Support interruption,
reload and reopening a prepared show's reading/control screen. Optional editing
must not silently publish local changes or overwrite colleagues' live operations.
This is a separate architectural slice from production directories.

## Prepared Offline Show

- An explicit Prepare Offline action downloads a complete text packet for the
  selected episode/bulletin: every ordered segment, saved scripts, presenter names,
  durations, notes and the last confirmed air state and approvals.
- Cache a dedicated offline-air app shell and its own versioned assets through
  the existing service worker. Keep push behavior. Do not cache authenticated API
  responses, login endpoints or the entire application indiscriminately.
- Store packets, local script drafts and local session journals in IndexedDB,
  namespaced by preparing user and database identity. Handle quota/permission
  errors without a false ready indicator. Old build cleanup must retain a working
  shell while an air session is active.
- Show Ready Offline only after shell availability and packet read-back checks
  pass. Progress, cancellation, packet timestamp, version and explicit removal
  are visible. No background download may block the existing live display.
- Offline availability starts after successful preparation while online. Never
  imply that a show not prepared can be downloaded after losing connectivity.
- Text packets are complete for reading and timing. External video/live links
  are not guaranteed offline; show their availability honestly. Downloading large
  video files and output routing to broadcast hardware are not part of this slice.

## Offline Viewer and Controls

- Dedicated route/view works after reload or reopening without reaching the
  server. It lists prepared shows and all their ordered segments; supports text,
  operating overview, large-font controls, fullscreen and mobile/desktop layouts.
- Continue the last locally selected script and time display if connectivity
  disappears while viewing. Keyboard commands ignore typing and dialogs.
- Local next/previous, start/pause/resume/end control a local air rehearsal/session
  only; label Local Operation clearly. These are never queued as shared onAir
  writes. A connected operator's shared broadcast cannot be overwritten by them.
- Persist the journal after each accepted local action using stable session/event
  IDs and ordered timestamps. Restore elapsed time after reload; detect major
  device-clock changes and request confirmation rather than silently jump timing.
- Going offline is determined by browser events and actual server reachability,
  not navigator.onLine alone. Connection checks do not interrupt text rendering.

## Optional Script Editing

- Station setting allowOfflineScriptEdits defaults to false. Local editing is
  offered only when enabled and the prepared user's editorial permissions allow it.
- Edited text stays as an explicitly marked local draft beside the downloaded
  baseline. Save locally, compare, undo and export are available without connection.
- No automatic script publication or synchronization. When online, show conflicts
  against the current server revision and require the ordinary editing permission,
  edit lock and explicit accepted-write confirmation before applying a chosen draft.
- A missing/deleted source or revoked permission blocks application of that draft,
  but does not destroy the local work; export/discard remain available.

## Reconnection and Multi-Operator Safety

- Offline local session records are separate from authoritative shared onAir state.
  Present current server state and local state together upon reconnecting.
- Importing the local session into the audit/As-Run record is an explicit action
  with current on-air permission and an idempotent session ID. Keep the offline
  origin, actor and timestamps; never rewrite existing server air log entries.
- If another operator progressed the shared show, display the difference and keep
  the local record separate. Resuming shared control uses current server state.
- Do not send stale next/start/end actions automatically after connectivity returns.

## Device Privacy and Lifecycle

- Preparing a packet requires authenticated read access and explicit local-storage
  consent; make the device/shared-computer implications clear in the preparation UI.
- Packets are scoped to the preparing account and database; normal sign-out removes
  that account's packets and drafts after explicit warning if local work is unsent.
- The dedicated offline viewer requires a locally established unlock secret for
  encrypted packets before reading them after browser restart. Use Web Crypto
  authenticated encryption; do not store the plaintext secret or send it to the server.
- Provide remove-packet/remove-all actions, retention controls and export-before-delete
  safeguards. No offline credential is a substitute for server authentication.

## Defaults and Stability

- Control-room display defaults to OPERATIONAL; presenter studio display to TEXT.
- Offline preparation is available, but no private packet is created without consent.
  Offline script editing is off by default; local control never changes shared state.
- Use existing domain timing and ordering helpers where possible. Keep network,
  packet persistence, encryption and viewer responsibilities separate and testable.
- A failed packet refresh preserves the previous complete packet. Never replace
  a ready packet with an incomplete download or mix segments from two revisions.

## Verification Gates

- Test actual browser offline mode, failed-server mode with browser still online,
  reload/reopen, all-segment navigation, script recovery, clock persistence and end.
- Test failed preparation, quota failure, cancelled download, stale packets and wrong
  unlock secrets; none may falsely claim ready or discard an existing valid packet.
- Test optional local edits and reconnect comparisons, permission revocation, row
  conflict, lock ownership, two operators and idempotent audit/session import.
- Verify no stale shared broadcast command is queued or replayed.
- Test sign-out purge, user/database isolation, cached-shell upgrade and preservation
  of push notifications. Check keyboard accessibility and 390px/1440px layouts.
- Live data must not be reset for tests. Publish exact tested coverage and limitations.

## Approval Gate

Review this written spec before preparing the separate implementation plan.
Production-directory and configurable text-display work can continue independently.
