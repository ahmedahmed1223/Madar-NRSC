import { useEffect, useState } from 'react';
import { currentTheme, setTheme, setThemePreference, subscribeTheme, ThemeMode, ThemePreference, themePreference } from '../services/theme';

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(currentTheme);
  const [preference, setPref] = useState<ThemePreference>(themePreference);
  useEffect(
    () =>
      subscribeTheme((m) => {
        setMode(m);
        setPref(themePreference());
      }),
    []
  );
  return {
    mode,
    preference,
    setTheme,
    setPreference: setThemePreference,
    toggle: () => setTheme(mode === 'dark' ? 'light' : 'dark'),
  };
}
