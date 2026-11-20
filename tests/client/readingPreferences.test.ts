import { describe, expect, it } from 'vitest';
import { readReadingPreferences, writeReadingPreferences, READING_DEFAULTS } from '../../src/services/readingPreferences';

describe('device reading preferences', () => {
  const makeStorage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), values };
  };

  it('keeps settings private to each account on the same device', () => {
    const storage = makeStorage();
    expect(writeReadingPreferences(storage, 'first', { fontSize: 54, color: 'cyan', mirrored: true, speed: 78 })).toBe(true);
    expect(readReadingPreferences(storage, 'first')).toEqual({ fontSize: 54, color: 'cyan', mirrored: true, speed: 78 });
    expect(readReadingPreferences(storage, 'second')).toEqual(READING_DEFAULTS);
  });

  it('ignores unsupported and out-of-range saved values and handles unavailable storage', () => {
    const storage = makeStorage();
    writeReadingPreferences(storage, 'first', READING_DEFAULTS);
    const [key] = storage.values.keys();
    storage.setItem(key, JSON.stringify({ fontSize: -1, color: 'red', mirrored: true, speed: 1000, playing: true, readingIndex: 4 }));
    expect(readReadingPreferences(storage, 'first')).toEqual({ ...READING_DEFAULTS, mirrored: true });
    storage.setItem(key, '{');
    expect(readReadingPreferences(storage, 'first')).toEqual(READING_DEFAULTS);
    expect(readReadingPreferences(null, 'first')).toEqual(READING_DEFAULTS);
    expect(writeReadingPreferences(null, 'first', READING_DEFAULTS)).toBe(false);
  });
});
