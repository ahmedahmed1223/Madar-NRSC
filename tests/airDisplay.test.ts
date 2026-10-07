import { expect, it } from 'vitest';
import { airDisplayDefault } from '../src/shared/airDisplay';
import { settingsError } from '../src/shared/settings';
it('defaults control-room to operational and studio to presenter text with validated overrides', () => {
  expect(airDisplayDefault({}, 'onAir')).toBe('OPERATIONAL');
  expect(airDisplayDefault({}, 'studio')).toBe('TEXT');
  expect(airDisplayDefault({ onAirDisplayMode: 'TEXT' }, 'onAir')).toBe('TEXT');
  expect(settingsError({ organizationName: 'مدار', defaultTimezone: 'UTC', enableAuditLog: true, onAirDisplayMode: 'INVALID' } as any)).toBeTruthy();
});
