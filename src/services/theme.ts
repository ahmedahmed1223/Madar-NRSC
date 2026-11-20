export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'nrcs-theme';
const listeners = new Set<(mode: ThemeMode) => void>();

function savedPreference(): ThemeMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

const systemPrefersDark = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

export function currentTheme(): ThemeMode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function apply(mode: ThemeMode, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 250);
  }
  root.classList.toggle('dark', mode === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0b1120' : '#0f172a');
  listeners.forEach((l) => l(mode));
}

/** Sets and remembers the day/night preference on this device. */
export function setTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
  apply(mode, true);
}

export type ThemePreference = ThemeMode | 'system';

/** What the colleague chose on this device ('system' follows the operating system). */
export function themePreference(): ThemePreference {
  return savedPreference() ?? 'system';
}

export function setThemePreference(pref: ThemePreference) {
  if (pref !== 'system') return setTheme(pref);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
  apply(systemPrefersDark() ? 'dark' : 'light', true);
}

export function subscribeTheme(listener: (mode: ThemeMode) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Until the user picks a mode, follow the operating system.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!savedPreference()) apply(systemPrefersDark() ? 'dark' : 'light', true);
  });
}

// --- Reduced motion -----------------------------------------------------------

const MOTION_KEY = 'nrcs-reduce-motion';

/** «تقليل الحركة»: no pulsing or animated transitions on this device. */
export function reducedMotion(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) === '1';
  } catch {
    return false;
  }
}

export function setReducedMotion(on: boolean) {
  try {
    if (on) localStorage.setItem(MOTION_KEY, '1');
    else localStorage.removeItem(MOTION_KEY);
  } catch {
    // storage unavailable: lasts for this page only
  }
  document.documentElement.classList.toggle('reduce-motion', on);
}

// --- Text size ----------------------------------------------------------------

const TEXT_KEY = 'nrcs-text-scale';

/** Interface text sizes a colleague may choose on their device; everything scales with the text. */
export const TEXT_SCALES = [
  { id: 'compact', name: 'مضغوط', hint: 'أصغر، لعرض أكثر على الشاشة' },
  { id: 'normal', name: 'عادي', hint: 'الحجم الأساسي' },
  { id: 'large', name: 'كبير', hint: 'أوضح للقراءة الطويلة' },
  { id: 'larger', name: 'أكبر', hint: 'لضعف النظر أو الشاشات البعيدة' },
] as const;
export type TextScale = (typeof TEXT_SCALES)[number]['id'];

export function textScale(): TextScale {
  try {
    const saved = localStorage.getItem(TEXT_KEY);
    return TEXT_SCALES.some((s) => s.id === saved) ? (saved as TextScale) : 'normal';
  } catch {
    return 'normal';
  }
}

export function setTextScale(scale: TextScale) {
  try {
    if (scale === 'normal') localStorage.removeItem(TEXT_KEY);
    else localStorage.setItem(TEXT_KEY, scale);
  } catch {
    // storage unavailable: lasts for this page only
  }
  if (scale === 'normal') delete document.documentElement.dataset.textScale;
  else document.documentElement.dataset.textScale = scale;
}

// Paper is always printed in the day palette: the night theme would print light text on white.
if (typeof window !== 'undefined') {
  let wasDark = false;
  window.addEventListener('beforeprint', () => {
    wasDark = document.documentElement.classList.contains('dark');
    if (wasDark) document.documentElement.classList.remove('dark');
  });
  window.addEventListener('afterprint', () => {
    if (wasDark) document.documentElement.classList.add('dark');
    wasDark = false;
  });
}
