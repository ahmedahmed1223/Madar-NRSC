import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDE_CHAPTERS, GUIDE_PARTS, ROLE_FAMILIES, roleFamilyOf, type GuideBlock } from '../../src/content/userGuide';
import { GUIDE_ENTRIES, findGuideTarget, guideSuggestion, guideToMarkdown, searchGuide } from '../../src/shared/userGuideTools';
import { TOURS } from '../../src/content/tours';
import { DEFAULT_ROLE_DEFINITIONS } from '../../src/shared/rbac';
import { isKnownScreen } from '../../src/services/router';
import { NAV_SECTIONS, sectionOfScreen } from '../../src/shared/navigation';
import { roleOpensScreen } from '../../src/shared/screens';

const blocks = (): GuideBlock[] => GUIDE_ENTRIES.flatMap(({ entry }) => entry.body);
const ids = (q: string) => searchGuide(q).map((h) => h.entry.id);

describe('user guide content', () => {
  it('gives every chapter and entry a unique id', () => {
    const all = [...GUIDE_CHAPTERS.map((c) => c.id), ...GUIDE_ENTRIES.map((x) => x.entry.id)];
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id, id).toMatch(/^[a-z0-9-]+$/);
  });

  it('places every chapter in a known part, in part order, and never leaves one empty', () => {
    const order = GUIDE_PARTS.map((p) => p.id);
    let last = 0;
    for (const chapter of GUIDE_CHAPTERS) {
      const at = order.indexOf(chapter.part);
      expect(at, chapter.id).toBeGreaterThanOrEqual(last);
      last = at;
      expect(chapter.entries.length, chapter.id).toBeGreaterThan(0);
      for (const entry of chapter.entries) expect(entry.body.length, entry.id).toBeGreaterThan(0);
    }
    for (const part of GUIDE_PARTS) expect(GUIDE_CHAPTERS.some((c) => c.part === part.id), part.id).toBe(true);
  });

  it('names only screens the app knows', () => {
    const screens = new Set<string>();
    for (const { entry } of GUIDE_ENTRIES) entry.screens.forEach((s) => screens.add(s));
    for (const b of blocks()) {
      if (b.kind === 'screen') screens.add(b.screen);
      if (b.kind === 'screens') b.items.forEach((i) => screens.add(i.screen));
    }
    for (const s of screens) expect(isKnownScreen(s), s).toBe(true);
  });

  it('starts only tours that exist', () => {
    const tours = blocks().filter((b): b is Extract<GuideBlock, { kind: 'tour' }> => b.kind === 'tour');
    expect(tours.length).toBeGreaterThan(0);
    for (const t of tours) expect(TOURS.some((x) => x.id === t.tour), t.tour).toBe(true);
  });

  it('links only to entries that exist', () => {
    for (const b of blocks()) if (b.kind === 'see') for (const id of b.entries) expect(findGuideTarget(id)?.entry, id).toBeTruthy();
  });

  it('gives each role family its chapter, covering every system role exactly once', () => {
    const codes = DEFAULT_ROLE_DEFINITIONS.map((r) => r.roleCode);
    const covered = ROLE_FAMILIES.flatMap((f) => f.roles);
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual([...codes].sort());
    for (const family of ROLE_FAMILIES) {
      const chapter = GUIDE_CHAPTERS.find((c) => c.id === family.id);
      expect(chapter?.part, family.id).toBe('roles');
      expect(chapter?.roles).toEqual(family.roles);
      expect(chapter!.entries.some((e) => e.id.endsWith('-day')), family.id).toBe(true);
    }
    for (const { entry } of GUIDE_ENTRIES) for (const role of entry.roles) expect(codes, `${entry.id}: ${role}`).toContain(role);
  });

  it('opens custom roles on the general chapter', () => {
    expect(roleFamilyOf('MONTAGE').id).toBe('role-montage');
    expect(roleFamilyOf('CUSTOM_ARCHIVIST').id).toBe('role-general');
    expect(roleFamilyOf(undefined).id).toBe('role-general');
  });

  it('holds the step-by-step guides the newsroom asked for', () => {
    const howtos = GUIDE_CHAPTERS.filter((c) => c.part === 'howto').flatMap((c) => c.entries);
    expect(howtos.length).toBeGreaterThanOrEqual(20);
    for (const id of [
      'howto-assign-from-template', 'howto-build-template', 'howto-send-back', 'howto-handover', 'howto-review-news', 'howto-field-breaking',
      'howto-manual-monitoring', 'howto-build-bulletin', 'howto-plan-episode', 'howto-studio-screen', 'howto-media', 'howto-connect-dropbox',
      'howto-connect-gdrive', 'howto-bridge', 'howto-station-group', 'howto-gm-stations', 'howto-departments', 'howto-custom-role',
      'howto-audit', 'howto-backup', 'howto-offline',
    ]) expect(howtos.some((e) => e.id === id), id).toBe(true);
  });

  it('is a screen everyone opens, in the help section of the rail', () => {
    expect(isKnownScreen('guide')).toBe(true);
    expect(NAV_SECTIONS.help.items).toContain('guide');
    expect(sectionOfScreen('guide')).toBe('help');
    expect(roleOpensScreen({ screens: [] }, 'guide')).toBe(true);
  });
});

describe('user guide search', () => {
  it('finds Arabic variants: plural, article, hamza and taa marbuta', () => {
    expect(ids('تكليفات')).toContain('screen-cards');
    expect(ids('التكليفات').length).toBeGreaterThan(0);
    expect(ids('تكليفات')).toContain('howto-assign-from-template');
    expect(ids('المناوبه')).toContain('howto-handover');
    expect(ids('الاعتماد')).toContain('howto-review-news');
    expect(ids('اجتازت التدقيق')).toContain('term-quality-pass');
    expect(ids('جسر')).toContain('howto-bridge');
  });

  it('ranks a title match first', () => {
    expect(searchGuide('ربط Dropbox')[0].entry.id).toBe('howto-connect-dropbox');
    // The glossary term of the same name and the how-to both lead.
    expect(ids('تسليم المناوبة').slice(0, 2).sort()).toEqual(['howto-handover', 'term-handover']);
  });

  it('shows the matching line', () => {
    const hit = searchGuide('رصد يدوي').find((h) => h.entry.id === 'howto-manual-monitoring');
    expect(hit?.snippet).toContain('رصد');
  });

  it('offers «هل تقصد» for a misspelt word', () => {
    expect(ids('تسلبم')).toEqual([]);
    expect(guideSuggestion('تسلبم', 0)).toBe('تسليم');
    expect(guideSuggestion('تسليم', ids('تسليم').length)).toBeNull();
  });
});

describe('docs/USER_GUIDE.md', () => {
  it('is generated from the current guide (run node scripts/export-user-guide.mjs)', () => {
    const committed = readFileSync(new URL('../../docs/USER_GUIDE.md', import.meta.url), 'utf8');
    expect(committed).toBe(guideToMarkdown());
  });

  it('carries every chapter and entry with its anchor', () => {
    const md = guideToMarkdown();
    for (const c of GUIDE_CHAPTERS) expect(md).toContain(`<a id="${c.id}"></a>`);
    for (const { entry } of GUIDE_ENTRIES) expect(md).toContain(`<a id="${entry.id}"></a>`);
  });
});
