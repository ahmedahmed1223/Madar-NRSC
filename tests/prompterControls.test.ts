import { expect, it } from 'vitest';
import { prompterScrollDelta, prompterShortcut } from '../src/shared/prompterControls';
it('keeps speed independent of refresh rate and caps suspended frames', () => {
  expect(prompterScrollDelta(48, 1000 / 60) * 60).toBeCloseTo(48);
  expect(prompterScrollDelta(48, 1000 / 144) * 144).toBeCloseTo(48);
  expect(prompterScrollDelta(48, 10000)).toBe(4.8);
});
it('protects native fields, composition and modified shortcuts', () => {
  expect(prompterShortcut({ key: ' ', tagName: 'INPUT' })).toBeNull();
  expect(prompterShortcut({ key: 'ArrowLeft', tagName: 'SELECT' })).toBeNull();
  expect(prompterShortcut({ key: ' ', tagName: 'BUTTON' })).toBeNull();
  expect(prompterShortcut({ key: 'ArrowUp', composing: true })).toBeNull();
  expect(prompterShortcut({ key: 'ArrowLeft', modified: true })).toBeNull();
  expect(prompterShortcut({ key: 'ArrowLeft' })).toBe('NEXT');
  expect(prompterShortcut({ key: 'ArrowUp' })).toBe('FASTER');
  expect(prompterShortcut({ key: 'Escape', tagName: 'INPUT' })).toBe('CLOSE');
});
