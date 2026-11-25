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

Scope restrictions must be distinguished from action permissions when applying
department inheritance. A syntactic denial of a restriction must not widen a
member's access to work outside their assigned scope.

**Why:** This application represents some restrictions as positive permission
flags; treating every flag as an ordinary action grant reverses the intended
security effect.

**How to apply:** Check the meaning of any scope-related flag before making it
grantable or deniable in a new policy source. Preserve the independent resource
and module checks rather than treating the effective permission list as the
entire authorization decision.

Lifting a scope restriction (removing it from a role, department policy, or a
user's exceptions) is an administrative widening act, not a permission grant:
it is refused through every write path — dedicated editor and legacy sync —
unless the acting account is a SUPER_ADMIN or is not itself subject to that
restriction. Denying a restriction is likewise refused everywhere.

**Why:** A reviewer showed that an individual "deny" of the assigned-work-only
flag cancelled an inherited restriction, because denial was applied before
department policy; adding a denial even looked like a reduction to the impact
preview. Removing a restriction is equally silent in a policy diff.

**How to apply:** When adding a scope-like flag, decide its removal rule at the
same time as its grant rule, and mirror anyone reviewing this area's mistake:
the effective decision, the impact preview, and the department-source
description must all come from the same resolver order (any ancestor denial wins
over a nearer grant).

Custom API routes that read records outside the regular sync/bootstrap filter
must enforce assigned-work scope explicitly before returning data or performing
related actions. This includes archive search/details, reports, history, and
exports that otherwise check only an action permission.

**Why:** The regular row filter hid non-assigned records, but direct archive and
report endpoints used permission checks alone, so a restricted account holding
`news.view` could still read those records.

**How to apply:** When adding custom search, aggregate, history, archive, or
export endpoints, verify they use the shared row visibility check or explicitly
reject accounts limited to assigned work; cover the direct route in an API test.
