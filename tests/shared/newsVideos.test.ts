import { describe, expect, it } from 'vitest';
import { formatClipDuration, parseClipDuration, primaryVideoUrl, totalVideoSeconds, videoLines, videosError, videosOf } from '../../src/shared/newsVideos';

const clips = [
  { id: 'a', title: 'لقطات الافتتاح', kind: 'location' as const, location: '\\\\NAS01\\القمة\\01', seconds: 45 },
  { id: 'b', title: 'تصريح الوزير', kind: 'link' as const, url: 'https://cdn.example/clip.mp4', seconds: 80, note: 'من الثانية 12' },
  { id: 'c', title: 'أرشيف', kind: 'library' as const, mediaId: 'med-1' },
];

describe('news video clips', () => {
  it('keeps older single-video stories working', () => {
    expect(videosOf({ videoUrl: 'https://x/y.mp4' })).toEqual([{ id: 'vid-legacy', title: 'المقطع', kind: 'link', url: 'https://x/y.mp4' }]);
    expect(videosOf({ videos: clips, videoUrl: 'https://old' })).toBe(clips);
    expect(videosOf({})).toEqual([]);
  });

  it('accepts links, library items and written locations; refuses incomplete clips', () => {
    expect(videosError(clips)).toBeNull();
    expect(videosError([{ id: 'x', title: 't', kind: 'link', url: 'ftp://nope' }])).toMatch(/الرابط/);
    expect(videosError([{ id: 'x', title: 't', kind: 'location', location: '  ' }])).toMatch(/أين يوجد/);
    expect(videosError([{ id: 'x', title: 't', kind: 'library' }])).toMatch(/مكتبة/);
    expect(videosError('nope')).toMatch(/غير صالحة/);
    expect(videosError(Array.from({ length: 31 }, (_, i) => ({ id: `v${i}`, title: '', kind: 'location', location: 'x' })))).toMatch(/30/);
  });

  it('durations, totals and the first playable link', () => {
    expect(parseClipDuration('01:20')).toBe(80);
    expect(parseClipDuration('45')).toBe(45);
    expect(parseClipDuration('')).toBeUndefined();
    expect(parseClipDuration('1:75')).toBeNaN();
    expect(formatClipDuration(125)).toBe('02:05');
    expect(totalVideoSeconds(clips)).toBe(125);
    expect(primaryVideoUrl(clips)).toBe('https://cdn.example/clip.mp4');
    expect(primaryVideoUrl([clips[2]], (id) => (id === 'med-1' ? '/api/v1/media/files/1' : undefined))).toBe('/api/v1/media/files/1');
  });

  it('lists clips in order for production', () => {
    const lines = videoLines(clips, () => 'أرشيف القمة 2025');
    expect(lines[0]).toMatch(/^1\. لقطات الافتتاح \(00:45\) — المكان: /);
    expect(lines[1]).toContain('— من الثانية 12');
    expect(lines[2]).toContain('مكتبة الوسائط: أرشيف القمة 2025');
  });
});
