import type { SystemSettings } from '../types';
export type AirDisplayMode = 'OPERATIONAL' | 'TEXT';
export function airDisplayDefault(settings: Partial<SystemSettings>, screen: 'onAir' | 'studio'): AirDisplayMode {
  const value = screen === 'onAir' ? settings.onAirDisplayMode : settings.studioDisplayMode;
  return value === 'TEXT' || value === 'OPERATIONAL' ? value : screen === 'onAir' ? 'OPERATIONAL' : 'TEXT';
}
