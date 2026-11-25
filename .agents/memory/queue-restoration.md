---
name: Queue restoration boundaries
description: Why work-queue preferences are tab-local and kept separate from focused record navigation
---
Work-queue restoration uses account-scoped browser-session storage, not shared device-wide legacy preferences or server-side synchronization.

**Why:** The requested outcome is to preserve a colleague's queue when navigating away and back, not to synchronize searches across devices or retain them indefinitely. Importing an unscoped legacy preference cannot establish which account chose it.

**How to apply:** Keep restoration isolated by account and screen. Treat a focused record link as a temporary view of that record, not a request to replace the colleague's saved filters. Validate dynamic choices only once their authoritative options have loaded.
