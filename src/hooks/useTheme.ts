import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'arbre-theme';

/**
 * Le thème clair est le défaut : c'est sur fond clair que le bois de l'arbre
 * et le verre des panneaux se lisent le mieux. Le choix de l'utilisateur, lui,
 * est mémorisé et l'emporte toujours.
 */
function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

/** Thème appliqué sur `<html>`, mémorisé entre deux visites. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((value) => (value === 'dark' ? 'light' : 'dark'));
  }, []);

  return [theme, toggle];
}
