import { expect, it } from 'vitest';
import { matchesShortcutKey } from '../src/shared/keyboard';

it('modified shortcuts accept Latin case and physical keys on Arabic layouts', () => {
  expect(matchesShortcutKey({ key: 'S', code: 'KeyS' }, 's')).toBe(true);
  expect(matchesShortcutKey({ key: 'س', code: 'KeyS' }, 's')).toBe(true);
  expect(matchesShortcutKey({ key: 'س', code: 'KeyK' }, 's')).toBe(false);
});
