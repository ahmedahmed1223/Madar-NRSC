import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES } from '../../src/content/help';
import { DEPARTMENTS } from '../../src/shared/departments';

describe('comprehensive in-app help', () => {
  it('covers recovery, roles, teamwork and all missing everyday workflows', () => {
    const ids = HELP_ARTICLES.map(article => article.id);
    for (const id of ['roles-permissions', 'draft-recovery', 'search-guide', 'tasks',
      'program-management', 'guest-directory', 'broadcast-calendar', 'team-collaboration',
      'troubleshooting', 'security-privacy', 'reports-audit', 'glossary']) {
      expect(ids).toContain(id);
    }
  });

  it('has unique IDs and populated, searchable sections with valid departments', () => {
    expect(new Set(HELP_ARTICLES.map(article => article.id)).size).toBe(HELP_ARTICLES.length);
    const departments = new Set<string>(DEPARTMENTS.map(department => department.id));
    for (const article of HELP_ARTICLES) {
      expect(article.title.trim()).not.toBe('');
      expect(article.summary.trim()).not.toBe('');
      expect(article.keywords.length).toBeGreaterThan(0);
      expect(article.sections.length).toBeGreaterThan(0);
      expect(new Set(article.sections.map(section => section.heading)).size).toBe(article.sections.length);
      for (const department of article.departments) expect(departments.has(department)).toBe(true);
      for (const section of article.sections) {
        expect(section.heading.trim()).not.toBe('');
        expect(section.steps.length).toBeGreaterThan(0);
        for (const step of section.steps) expect(step.trim()).not.toBe('');
      }
    }
  });

  it('does not mistake a connection indicator for a saved document', () => {
    expect(HELP_ARTICLES.some(article => article.sections.some(section =>
      section.steps.some(step => step.includes('أخضر = متصل ومحفوظ'))))).toBe(false);
  });
});
