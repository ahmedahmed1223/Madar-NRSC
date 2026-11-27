// The «مدار» palette (see DESIGN.md): warm paper, navy ink, one cyan-teal signal.
// Components keep Tailwind's colour names; these values replace the two scales the app is built on.

/** Neutrals (Tailwind «slate»): paper and rules at the light end, navy ink at the dark end. */
export const INK = {
  50: 'oklch(98.3% 0.0045 85)',
  100: 'oklch(96.2% 0.0065 85)',
  200: 'oklch(91.8% 0.009 82)',
  300: 'oklch(85.5% 0.012 78)',
  400: 'oklch(69% 0.022 258)',
  500: 'oklch(50% 0.036 258)',
  600: 'oklch(43% 0.04 260)',
  700: 'oklch(36% 0.044 262)',
  800: 'oklch(28% 0.046 264)',
  900: 'oklch(21.5% 0.044 265)',
  950: 'oklch(16% 0.038 266)',
};

const signal = (lightness, chroma, hue) => `oklch(${lightness}% ${chroma} calc(${hue} + var(--madar-signal-hue-offset, 0)))`;

/** Signal (Tailwind «blue»): preserve contrast while the institution selects a hue. */
export const SIGNAL = {
  50: signal(97.6, 0.016, 205),
  100: signal(94.6, 0.034, 205),
  200: signal(89.2, 0.06, 205),
  300: signal(81.5, 0.088, 205),
  400: signal(71, 0.11, 207),
  500: signal(60.5, 0.115, 210),
  600: signal(50.5, 0.106, 213),
  700: signal(44, 0.094, 215),
  800: signal(38, 0.08, 217),
  900: signal(32, 0.066, 219),
  950: signal(24, 0.05, 221),
};

/** Night-mode neutrals: deep ink surfaces, paper text. */
export const INK_NIGHT = {
  50: 'oklch(16.5% 0.03 264)',
  100: 'oklch(24% 0.034 263)',
  200: 'oklch(30.5% 0.036 261)',
  300: 'oklch(39.5% 0.038 259)',
  400: 'oklch(64% 0.034 257)',
  500: 'oklch(71% 0.03 257)',
  600: 'oklch(76% 0.026 256)',
  700: 'oklch(85% 0.016 255)',
  800: 'oklch(91% 0.01 80)',
  900: 'oklch(95% 0.007 82)',
  950: 'oklch(98% 0.004 85)',
};

/** Night-mode card surface (Tailwind «white»). */
export const SURFACE_NIGHT = 'oklch(20.5% 0.034 264)';
