import { useCallback, useLayoutEffect, useState } from 'react';

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

  // Effet de disposition, et non effet ordinaire.
  //
  // La couche de canevas lit la palette de l'arbre dans les variables CSS au
  // montage. Les effets ordinaires s'exécutent des enfants vers le parent :
  // le canevas aurait donc lu ses couleurs avant que le thème soit posé sur
  // <html>, et l'arbre serait resté peint aux teintes du thème sombre au
  // milieu d'une interface claire. Les effets de disposition, eux, passent
  // tous avant.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((value) => (value === 'dark' ? 'light' : 'dark'));
  }, []);

  return [theme, toggle];
}
