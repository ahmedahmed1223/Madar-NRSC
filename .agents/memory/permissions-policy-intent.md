---
name: Department permission intent
description: Approved department inheritance and restriction rules for permission management
---
The user approved inherited department permissions rather than copying grants to
each member. Department denial must not be bypassed by an individual grant;
individual denial can restrict a department grant. Keep the existing role
baseline, inactive-account restriction and protected super-administrator behavior.
Department-wide grants must not confer user/permission administration or system
administration, and permission grants never override station/resource scope.

**Why:** The user accepted the revised design after a critique demonstrated that
always prioritizing individual grants would bypass an intentional department ban.

**How to apply:** Treat this as product intent when implementing or revising
permissions, not as evidence that department inheritance is already implemented.
Provide effective-source explanations and explicit save/cancel with impact
preview; do not automatically populate policies or reset existing user choices.
