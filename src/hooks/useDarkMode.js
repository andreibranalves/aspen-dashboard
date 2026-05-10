import { useState, useEffect } from 'react';

const STORAGE_KEY = 'aspen_theme';

/**
 * useDarkMode — Framer dark-only.
 * Always applies 'dark' class to <html>. The toggle is retired
 * because Framer's identity is dark-only (per DESIGN.md §Dos and Don'ts).
 * Returns { darkMode: true, toggleDarkMode: no-op } for API compatibility.
 */
export function useDarkMode() {
  const [darkMode] = useState(true);

  // Apply 'dark' class on mount (always)
  useEffect(() => {
    document.documentElement.classList.add('dark');
    try {
      localStorage.setItem(STORAGE_KEY, 'dark');
    } catch {
      // localStorage unavailable
    }
  }, []);

  // No-op toggle — Framer is dark-only
  const toggleDarkMode = () => {};

  return { darkMode, toggleDarkMode };
}
