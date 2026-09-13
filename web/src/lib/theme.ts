'use client';

/**
 * theme.ts — Crucible AI theme state. Theme is the `.dark` class on <html>;
 * light is the default. Persisted in localStorage, cross-instance sync
 * via the `crucible-theme` event (Clerk appearance listens to it too).
 */
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'crucible_theme';

export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent<Theme>('crucible-theme', { detail: theme }));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(getTheme());
    const sync = () => setTheme(getTheme());
    window.addEventListener('crucible-theme', sync as EventListener);
    return () => window.removeEventListener('crucible-theme', sync as EventListener);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
    apply(next);
    setTheme(next);
    return next;
  }, []);

  return { theme, toggle, isDark: theme === 'dark' };
}
