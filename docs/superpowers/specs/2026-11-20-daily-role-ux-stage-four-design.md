# Daily Role UX Stage Four Design

The mobile field form and regular editor share an attachment picker. Give both a direct file chooser when the user can upload, with a sequential upload queue, measured progress, retry, and explicit attachment confirmation. Keep the draft form mounted through every attempt. Reuse the existing authenticated upload request, media registration, and editorial submission. Closing the picker cancels unfinished transfers. A retry after a transfer failure sends the file again. Uploaded bytes and confirmation of the media record are distinct states.

Reuse the online prompter and offline reader for personal settings on this device. Store the font size, text color, mirror setting, and online scroll speed per account. The offline reader identifies the account after decryption. Controls apply to the reading surface and preserve the existing playback and live command boundaries.

The existing local preparation panel shows when a packet was prepared, flags a changed rundown or on-air state using the latest available server-synced data, and describes unknown freshness for old packets or unavailable comparisons. The offline viewer shows the snapshot timestamp and describes the limits of verification. Preparing another encrypted copy remains explicit and preserves older copies and their local work.

Reusing these paths keeps current access controls and error handling. An alternate upload protocol or a new server-backed settings collection would add operational contracts for device-specific behavior. This stage adds neither a packet download endpoint nor a background file uploader.
