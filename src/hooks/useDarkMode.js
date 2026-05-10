import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'aspen_theme';

function getInitialDarkMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
  } catch {
    // localStorage indisponível (SSR / iframe bloqueado)
  }
  // Fallback: preferência do sistema
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyDarkClass(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function useDarkMode() {
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);

  // Aplica a classe 'dark' no <html> no init e quando mudar
  useEffect(() => {
    applyDarkClass(darkMode);
  }, [darkMode]);

  // Escuta mudanças na preferência do sistema (se não houver override manual)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      // Só segue o sistema se o usuário nunca escolheu manualmente
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === null) {
        setDarkMode(e.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
      } catch {
        // silencioso
      }
      return next;
    });
  }, []);

  return { darkMode, toggleDarkMode };
}
