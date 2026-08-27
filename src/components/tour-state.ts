/*
 * L'état « guide déjà vu », séparé du guide lui-même.
 *
 * `App` doit savoir s'il faut l'ouvrir AVANT de le charger — or le guide est
 * chargé à la demande. Garder ce drapeau dans le composant obligerait à
 * télécharger tout le guide, ses cinq scènes comprises, uniquement pour
 * découvrir qu'on n'a pas à l'afficher.
 */
const SEEN_KEY = 'arbre:guide-vu';

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Navigation privée, stockage refusé : on considère le guide comme vu
    // plutôt que de le réimposer à chaque ouverture.
    return true;
  }
}

export function rememberTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* voir `hasSeenTour` */
  }
}
