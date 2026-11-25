/**
 * Throwaway policy experiment, NOT connected to authentication or stored data.
 * Run: npx tsx scripts/experiments/department-permissions.spike.ts
 */
import assert from 'node:assert/strict';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_DEFINITIONS,
  evaluatePermission,
} from '../../src/shared/rbac';
import type { User } from '../../src/types';

type Choice = 'inherit' | 'grant' | 'deny';
type Policy = {
  active?: boolean;
  superAdmin?: boolean;
  role: boolean;
  departments?: Choice[];
  user?: Choice;
  moduleAvailable?: boolean;
  withinScope?: boolean;
};

// This models an action decision, not just a permission flag.
// Scope/module conditions are synthetic inputs, not real resource checks.
function candidate(p: Policy) {
  if (p.active === false) return { allowed: false, source: 'inactive' };
  if (p.moduleAvailable === false) return { allowed: false, source: 'module' };
  if (p.withinScope === false) return { allowed: false, source: 'scope' };
  if (p.superAdmin) return { allowed: true, source: 'super-admin' };
  if (p.user === 'deny') return { allowed: false, source: 'user-deny' };
  if (p.departments?.includes('deny')) return { allowed: false, source: 'department-deny' };
  if (p.user === 'grant') return { allowed: true, source: 'user-grant' };
  if (p.departments?.includes('grant')) return { allowed: true, source: 'department-grant' };
  return { allowed: p.role, source: 'role' };
}

const cases: { name: string; input: Policy; allowed: boolean; source: string }[] = [
  { name: 'Role baseline is preserved', input: { role: true }, allowed: true, source: 'role' },
  { name: 'Default remains denied', input: { role: false }, allowed: false, source: 'role' },
  { name: 'Department grants an absent role permission', input: { role: false, departments: ['grant'] }, allowed: true, source: 'department-grant' },
  { name: 'Department deny restricts a role grant', input: { role: true, departments: ['deny'] }, allowed: false, source: 'department-deny' },
  { name: 'Individual exception can grant when department inherits', input: { role: false, departments: ['inherit'], user: 'grant' }, allowed: true, source: 'user-grant' },
  { name: 'Individual deny restricts a department grant', input: { role: false, departments: ['grant'], user: 'deny' }, allowed: false, source: 'user-deny' },
  { name: 'Individual grant cannot bypass department deny', input: { role: false, departments: ['deny'], user: 'grant' }, allowed: false, source: 'department-deny' },
  { name: 'Child grant cannot bypass ancestor deny', input: { role: false, departments: ['deny', 'grant'] }, allowed: false, source: 'department-deny' },
  { name: 'Disabling an account removes access', input: { active: false, role: true, departments: ['grant'], user: 'grant' }, allowed: false, source: 'inactive' },
  { name: 'Disabled administrator also remains blocked', input: { active: false, superAdmin: true, role: true }, allowed: false, source: 'inactive' },
  { name: 'Active administrator is protected from permission lockout', input: { superAdmin: true, role: true, departments: ['deny'], user: 'deny' }, allowed: true, source: 'super-admin' },
  { name: 'A grant never enables an unavailable module', input: { role: true, user: 'grant', moduleAvailable: false }, allowed: false, source: 'module' },
  { name: 'A grant never crosses the supplied resource scope', input: { role: true, user: 'grant', withinScope: false }, allowed: false, source: 'scope' },
];

for (const scenario of cases) {
  assert.deepEqual(candidate(scenario.input), { allowed: scenario.allowed, source: scenario.source }, scenario.name);
  console.log(`PASS ${scenario.name}`);
}

// Moving an employee removes the old department's grant. No permission copy.
const beforeMove = { role: false, departments: ['grant'] as Choice[] };
const afterMove = { ...beforeMove, departments: ['inherit'] as Choice[] };
assert.equal(candidate(beforeMove).allowed, true);
assert.equal(candidate(afterMove).allowed, false);
console.log('PASS Moving departments recalculates inherited access');

// Check no-department compatibility against the actual current pure evaluator.
// These are invented users and role definitions already in source, not DB rows.
let compatibilityChecks = 0;
for (const role of DEFAULT_ROLE_DEFINITIONS) {
  for (const permission of ALL_PERMISSIONS) {
    for (const choice of ['inherit', 'grant', 'deny'] as Choice[]) {
      const user = {
        role: role.roleCode as User['role'],
        customRoleId: role.id,
        isActive: true,
        customPermissions: choice === 'inherit' ? [] : [choice === 'deny' ? `!${permission.code}` : permission.code],
      };
      const expected = evaluatePermission(user, permission.code, DEFAULT_ROLE_DEFINITIONS);
      const actual = candidate({
        role: role.permissions.includes(permission.code),
        superAdmin: user.role === 'SUPER_ADMIN',
        user: choice,
      });
      assert.equal(actual.allowed, expected, `${role.roleCode}/${permission.code}/${choice}`);
      compatibilityChecks++;
    }
  }
}

// Reproduce the first proposal's weakness so this critique is executable.
const firstProposal = (department: Choice, user: Choice) =>
  user !== 'inherit' ? user === 'grant' : department === 'grant';
assert.equal(firstProposal('deny', 'grant'), true);
assert.equal(candidate({ role: false, departments: ['deny'], user: 'grant' }).allowed, false);

console.log(JSON.stringify({
  policyScenariosPassed: cases.length + 1,
  noDepartmentCompatibilityChecksPassed: compatibilityChecks,
  originalProposalBypassReproduced: true,
  applicationPolicyChanged: false,
  databaseAccessed: false,
}, null, 2));
