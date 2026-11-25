---
name: Stable large-list paging
description: Keep history pages complete when newsroom records change during browsing.
---

Use keyset paging based on the last visible row's sort position and ID instead of a numeric offset.

**Why:** Colleagues can insert new, newest-first rows while someone is paging through history; offsets then shift and can duplicate or skip records.

**How to apply:** Use the visible row that ends a page as the next cursor. Apply the user's read and station/task scopes before returning rows, and never put hidden-row IDs in a cursor.
