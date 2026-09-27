import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderDocx } from '../../src/services/documents/renderDocx';
import { renderHtml } from '../../src/services/documents/renderHtml';
import { fileNameOf, scriptParts } from '../../src/services/documents/model';
import * as B from '../../src/services/documents/builders';
import { INITIAL_EPISODES, INITIAL_GUESTS, INITIAL_NEWS } from '../../src/services/mockData';
import { demoBulletin } from '../../src/services/demoBulletins';
import { arabicDate } from '../../src/shared/dates';

const ctx = { organization: 'شبكة مدار', user: { fullName: 'سارة' } };
const { bulletin, stories } = demoBulletin('2026-09-27');

describe('exported documents', () => {
  it('builds the story sheet with its approval trail and a safe file name', () => {
    const doc = B.newsStoryDoc(INITIAL_NEWS[0] as any, ctx);
    expect(doc.fileName).not.toMatch(/[\\/:*?"<>|]/);
    expect(doc.blocks.some((b) => b.t === 'heading' && b.text === 'مسار المراجعة والاعتماد')).toBe(true);
    expect(fileNameOf('خبر', 'أ/ب:ج')).toBe('خبر - أ ب ج');
  });

  it('prints the bulletin rundown with back times and leaves killed stories out', () => {
    const doc = B.bulletinRundownDoc(bulletin, [...stories, { ...stories[1], id: 'k', slug: 'مستبعدة', killed: true }], ctx);
    const table = doc.blocks.find((b) => b.t === 'table') as any;
    expect(table.head).toContain('Back');
    expect(table.rows.some((r: any) => r.cells[1].includes('مستبعدة'))).toBe(false);
    expect(table.rows.find((r: any) => r.cells[1].includes('احتياط')).kind).toBe('muted');
  });

  it('puts one story per page in the anchor scripts', () => {
    const doc = B.anchorScriptsDoc(bulletin, stories, ctx);
    const scripts = doc.blocks.filter((b) => b.t === 'script').length;
    expect(doc.blocks.filter((b) => b.t === 'pagebreak').length).toBe(scripts - 1);
  });

  it('writes dates readably inside Arabic text', () => {
    expect(arabicDate('2026-09-27')).toBe('27 سبتمبر 2026');
    expect(B.episodeFileDoc(INITIAL_EPISODES[0] as any, INITIAL_GUESTS as any, ctx).subtitle).toContain('سبتمبر 2026');
  });

  it('renders an A4 print page with page numbers and escaped content', () => {
    const html = renderHtml({ title: 'عنوان <b>', fileName: 'x', blocks: [{ t: 'paragraph', text: '<script>x</script>' }] });
    expect(html).toContain('counter(pages)');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('produces a right-to-left Word file', async () => {
    const blob = await renderDocx(B.episodeFileDoc(INITIAL_EPISODES[0] as any, INITIAL_GUESTS as any, ctx));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:bidi/>');
    expect(xml).toContain('<w:rtl/>');
    expect(xml).toContain('<w:bidiVisual/>'); // tables run right to left
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toContain('قمة الاستثمار');
  });

  it('separates bracketed directions from spoken copy', () => {
    expect(scriptParts('مساء الخير [كاميرا 2] نبدأ')).toEqual([
      { cue: false, text: 'مساء الخير ' },
      { cue: true, text: '[كاميرا 2]' },
      { cue: false, text: ' نبدأ' },
    ]);
  });
});
