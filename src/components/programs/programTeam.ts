/** Choosing a program's team from the active colleagues (team members are stored by name). */

export interface TeamOption {
  name: string;
  detail: string;
}

interface UserLike {
  fullName: string;
  jobTitle?: string;
  department?: string;
  isActive?: boolean;
  deletedAt?: string | null;
}

/**
 * The active colleagues to pick from (by name, A–Z), and the saved members who are not among
 * them (a former colleague, or a name typed before the list existed) so they can still be removed.
 */
export function programTeamOptions(users: UserLike[], selected: string[]): { users: TeamOption[]; others: string[] } {
  const seen = new Set<string>();
  const options: TeamOption[] = [];
  for (const u of users) {
    const name = (u.fullName || '').trim();
    if (!name || u.isActive === false || u.deletedAt || seen.has(name)) continue;
    seen.add(name);
    options.push({ name, detail: [u.jobTitle, u.department].filter(Boolean).join(' · ') });
  }
  options.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const others = [...new Set(selected.map((n) => (n || '').trim()).filter((n) => n && !seen.has(n)))];
  return { users: options, others };
}

/** Adds or removes one name, keeping the existing order and no duplicates. */
export function toggleTeamMember(selected: string[], name: string): string[] {
  const clean = name.trim();
  return selected.some((n) => n.trim() === clean) ? selected.filter((n) => n.trim() !== clean) : [...selected, clean];
}
