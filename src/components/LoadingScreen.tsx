export interface LoadingScreenProps {
  /** Amorce le fondu de sortie ; le composant reste monté le temps qu'il se termine. */
  leaving: boolean;
}

/**
 * Écran de chargement affiché à l'ouverture, quelle que soit la vitesse
 * réelle du calcul du graphe — voir App.tsx pour la durée minimale imposée.
 */
export function LoadingScreen({ leaving }: LoadingScreenProps) {
  return (
    <div
      className={`loading-screen${leaving ? ' loading-screen--leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={leaving}
    >
      <svg className="loading-mark" viewBox="0 0 32 32" width="40" height="40" aria-hidden="true">
        <circle cx="16" cy="9" r="3" />
        <circle cx="9.5" cy="23" r="3" />
        <circle cx="22.5" cy="23" r="3" />
        <path d="M16 12v4M9.5 20v-4h13v4" fill="none" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <p className="loading-title">Arbre généalogique</p>
      <p className="loading-subtitle">Chargement de l’arbre…</p>
    </div>
  );
}
