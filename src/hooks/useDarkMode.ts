import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'aspen_theme';

function getInitialTheme(): boolean {
  if (typeof window === 'undefined') return true;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
  } catch {
    // localStorage unavailable — fall back to system preference
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * useDarkMode — user-selectable light/dark theme.
 * Persists in localStorage and applies/removes the `dark` class on <html>.
 */
export function useDarkMode() {
  const [darkMode, setDarkMode] = useState<boolean>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';

    try {
      localStorage.setItem(STORAGE_KEY, darkMode ? 'dark' : 'light');
    } catch {
      // localStorage unavailable
    }
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => !prev);
  }, []);

  return { darkMode, toggleDarkMode };
}
