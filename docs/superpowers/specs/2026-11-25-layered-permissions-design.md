# صلاحيات الأدوار والأقسام والمستخدمين

## Intent and approval
The user approved the revised proposal after a critique and isolated policy
experiment: easier Arabic permissions editing, inherited department policy,
individual customization, mandatory department denials, and explicit saving.
This document records that approved design; no live policy has been changed.

## Current system and constraints
- The app has custom authentication, roles, individual grants and explicit denies.
- Administrative departments have stable IDs, optional parents, station
  restrictions, and archiving. They are not news categories.
- Preserve accounts, passwords, existing role definitions, and individual
  overrides. An installation without department overrides must behave as before.
- Keep the existing database and authentication implementations. Production
  migration and publishing are separate work.

## Approaches
1. Copy department permissions onto each user: simpler initially, but copies
   become stale and do not follow transfers or new membership. Rejected.
2. Always let individual overrides win: flexible, but bypasses mandatory
   department restrictions. Rejected after the experiment.
3. Calculate access from role, department policy and individual overrides:
   selected, with department denies taking precedence over individual grants.

## Approved behavior
- Inactive accounts remain blocked; preserve active SUPER_ADMIN protection.
- For other accounts, explicit individual denial or department/ancestor denial
  blocks the permission; otherwise an individual grant, department/ancestor
  grant, or role grant permits it. No grant means denied.
- Department overrides are inherited, not copied. Joining, transferring and
  changing parent departments recalculate access.
- Department grants cannot confer user administration, permissions
  administration, system configuration or database administration.
- Module availability and resource/station scope remain separate constraints:
  possession of a permission does not bypass either.
- Show the effective permission and the reason/source, including blocked
  individual grants and inherited parent restrictions.
- Existing role and user customization remains available.

## Editing experience
Within the existing users and permissions area, offer role, department and user
selection, grouped permission categories, search, and inherited/granted/denied
states. Replace the wide matrix as the primary editing experience.
Retain role creation/editing/deletion and account management.
Use the existing Arabic RTL visual system and support mobile and keyboard use.

Changes stay in a draft until saved. Display changed permissions, affected users
and a before/after summary before application. Cancel must discard the draft;
navigation away from unsaved edits must warn. Errors and concurrent changes must
not be reported as success or silently overwrite a newer policy.
Audit successful changes and propagate effective permissions to connected users.

## Non-goals
No new identity provider, automatic role assignments, automatic permission
grants to existing departments, user deletion, database replacement, production
migration, or deployment. The isolated experiment is not a production
authorization engine or evidence of full integration.
