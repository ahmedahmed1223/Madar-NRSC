# Editorial Production Tools

Date: 2026-10-10. Status: proposed written specification, awaiting review before implementation planning.

## Purpose

Complete guest follow-up, introduce a written pronunciation dictionary, and record newsroom corrections. Serve producers, editors, presenters and desk managers without changing shared on-air copy automatically. The user approved these three feature scopes; this document defines their implementation contracts.

Preserve current data, permissions, collaboration locks and confirmed-save behavior. No new dependencies, automatic AI services, release publication or live data migration operations are requested by this scope.

## Existing System

- Guest booking already supports CANDIDATE, CONTACTED, CONFIRMED, DECLINED and ARRIVED, contact logs and backup guests. Extend it rather than create a second booking workflow.
- Episode editing is governed by episodes.edit and current edit locks. Existing server validation must accept only the bounded new fields.
- News versions/history and links from bulletin stories and rundown segments already exist. A correction record complements them; it does not replace history or broadcast commands.
- Offline air packets use version 1, strict bounded validation, encryption and explicit reconciliation. Old prepared packets must remain readable.

## Guest Follow-Up

Add optional fields to each EpisodeGuest: contactOwnerId, technicalCheckAt (ISO UTC), technicalCheckStatus (NOT_REQUIRED, PENDING, PASSED, FAILED), and technicalCheckNote (at most 1000 characters). Missing legacy status is interpreted as NOT_REQUIRED; existing guests do not become blocked retroactively.

Owner selection lists active users; existing inactive owner names remain readable and can be reassigned. Existing booking states remain authoritative. Schedule input follows station timezone conventions and shows the effective timezone. Validate date, enums, owner and length on the server.

Provide compact controls in the existing guest panel, with read-only states for users lacking episodes.edit. Use a dedicated confirmed save for these fields. Keep entered values after rejection, prevent duplicate submission, and surface lock/conflict failures without claiming success. Do not clear pending contact notes on failed saving.

Readiness shows missing owner for a contacted/confirmed guest and a pending or failed required technical check as actionable warnings. These warnings do not introduce a new blocking rule for broadcast. Any future mandatory requirement needs a separately approved policy. Existing material blockers remain unchanged.

## Pronunciation Dictionary

Add a pronunciationTerms collection with id, term (1-200 characters), pronunciation (1-300), note (0-1000), enabled, and server-managed audit metadata. Reject invalid fields and duplicate active normalized terms on the server; normalize with existing Arabic search conventions. Limit the shared dictionary to 2000 active entries.

Manage entries in an existing editorial settings section under system.settings. Authorized news/show readers may view relevant reference notes; ordinary clients cannot forge creator/updater metadata. Dictionary entries are shared editorial reference content, not a place for passwords or personal contact data. Apply existing delete/version/conflict patterns.

Show a searchable dictionary in editor/reference surfaces and a collapsible pronunciation panel in the teleprompter. Match terms against the currently loaded script using deterministic normalized matching, not an AI service. Limit panel results and preserve the original script. Short ambiguous matches must be reviewed by the presenter; no automatic replacement or insertion into the spoken text. The panel must not cover the reading line or change scroll speed/position when opened.

Prepare only matching term/pronunciation/note values in a bounded optional pronunciationNotes packet field (at most 200 terms). Default missing field to an empty list for legacy version-1 packets. Include it in the existing encrypted/proven packet representation. Offline notes are a snapshot as of preparation; changing the shared dictionary does not silently update a packet or merge local copy into it. Re-preparation is explicit.

No recorded audio, text-to-speech or phonetic inference is included.

## Correction Register

Add an append-only newsCorrections collection. Create records through a server endpoint, not unrestricted generic sync. Each record contains server-generated id, newsId, current news entity version, reason (required, 1-2000 characters), summary (1-1000), actorId/name and server timestamp. Do not duplicate full story text; retain the existing news history as the version source. History retention can make an old full-text comparison unavailable, and the UI must state that rather than imply permanent archival.

Register a correction after a confirmed news edit, or document a correction to the current saved version. Require news.review or news.edit_any, news access, a non-deleted target and an expected version matching the current saved row. A concurrent edit returns a conflict; preserve the correction form and require review of the new version before retry. A correction record alone does not change text, status or approvals and is not a claim that the material has already been corrected on air.

Use an idempotency key bound to actor, target version and payload to prevent duplicate records and alerts after retry. Create the record, audit entry and authorized bell notifications in one database transaction. Reject client-generated actor/time fields. Records are immutable and not client-deletable; mistakes can be documented by a new linked correction note rather than destroying the audit trail.

Display chronological records in the news editor and a clear correction badge on linked bulletin stories and episode rundown segments. Derive links using existing newsId fields. Notify active colleagues responsible for currently linked materials who retain permission to access them; do not notify every account or expose inaccessible content. Use existing notification preferences and channels, deduplicate by correction/recipient, and provide a link to the record or permitted news page.

Do not automatically replace linked scripts, interrupt a teleprompter, revoke approvals or replay a broadcast action. Show the desk manager what changed and leave any script update to the existing explicit comparison/editor workflow. Already prepared offline packets cannot receive new corrections while disconnected; their preparation time remains visible.

## UI and Accessibility

Retain the application's existing components, RTL layout, theme system and icon library. Avoid separate duplicate guest/status screens. Controls support labels, visible focus, keyboard navigation, 44px touch commands, busy states and explicit retry. Restore focus after closing dialogs. Show errors inline with entered values preserved.

Verify 390px mobile and 1440px desktop, light/dark, keyboard and overflow. Status announcements distinguish local drafts from confirmed server data. None of these features promise comprehensive offline editing outside the existing approved air subsystem.

## Verification and Completion Criteria

- Guest server tests: legacy defaults, valid/invalid owner and time, unauthorized edits, conflicts/locks, optional warnings and unchanged broadcast blockers.
- Dictionary server tests: permission, bounded input, normalized duplicates, immutable audit metadata and concurrent updates. Matching tests include Arabic variants, punctuation, ambiguous/short terms, result bounds and unchanged script bytes.
- Offline tests: old packets, new encrypted packets, reopen without a network, relevant-note selection and no automatic shared dictionary mutation.
- Correction server tests: authenticated permissions, CSRF, inaccessible/deleted news, expected-version conflicts, replay/idempotency, immutable records, atomic audit/notifications and authorized recipients.
- Browser journeys: failed save retains guest fields, correction registration and retry, linked warning navigation, dictionary CRUD, and pronunciation panel without teleprompter position/speed changes. Screenshots and accessibility checks cover mobile/desktop and both themes.
- Full TypeScript/unit/server/build check, focused browser regressions, and review before any later integration. Production data is never used for destructive tests.

## Excluded

No automatic correction publication, automatic text replacement, mandatory technical-check air gate, audio pronunciation generation, new notification transport, full historical media archive, integration/release bump or push unless requested separately.
