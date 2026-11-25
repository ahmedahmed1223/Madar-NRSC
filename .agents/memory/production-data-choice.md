---
name: Production data choice
description: The user's selected database and data-preservation requirement for production
---
Use Replit PostgreSQL for production and transfer existing data and user accounts rather than starting with an empty database.

**Why:** The user selected “Replit PostgreSQL مع نقل البيانات” when asked which production database setup to use.

**How to apply:** Preserve account identities, password hashes, permissions, and relationships during migration. Confirm the authoritative source database before importing; generated development or demo accounts are not real production accounts.
