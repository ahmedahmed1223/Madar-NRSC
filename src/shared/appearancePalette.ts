export const COLOR_PALETTES = {
  petrol: { label: 'بترولي مدار', swatch: 'oklch(50.5% 0.106 213)' },
  editorial: { label: 'أزرق تحريري', swatch: 'oklch(50.5% 0.106 257)' },
  olive: { label: 'أخضر زيتوني', swatch: 'oklch(50.5% 0.106 128)' },
  violet: { label: 'بنفسجي حبري', swatch: 'oklch(50.5% 0.106 295)' },
} as const;

export type ColorPalette = keyof typeof COLOR_PALETTES;

export function isColorPalette(value: unknown): value is ColorPalette {
  return typeof value === 'string' && Object.hasOwn(COLOR_PALETTES, value);
}

export function resolveColorPalette(value: unknown): ColorPalette {
  return isColorPalette(value) ? value : 'petrol';
}
