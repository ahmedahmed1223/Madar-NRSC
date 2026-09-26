import { useEffect, useState } from 'react';
import { currentTheme, setTheme, subscribeTheme, ThemeMode } from '../services/theme';

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(currentTheme);
  useEffect(() => subscribeTheme(setMode), []);
  return { mode, setTheme, toggle: () => setTheme(mode === 'dark' ? 'light' : 'dark') };
}
