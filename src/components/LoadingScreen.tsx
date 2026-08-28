import { useEffect, useMemo, useState } from 'react';

export interface LoadingScreenProps {
  /** Passe à `true` dès que l'arbre est cadré et prêt à apparaître. */
  ready: boolean;
  /** Nom de la famille, tel qu'il est saisi dans les données. */
  title?: string;
  /** Quelques noms réels, du plus ancien au plus récent. */
  names?: string[];
  /** Nombre de personnes dans l'arbre. */
  people?: number;
  /** Nombre de générations couvertes. */
  generations?: number;
}

/*
 * Combien de temps le rideau reste, au minimum.
 *
 * La première visite laisse le temps de lire l'emblème et le nom qui
 * défilent ; les suivantes se contentent du temps réel du chargement —
 * mesuré sur cette application, la page est prête en moins de 200 ms.
 *
 * 1400 ms, essayé d'abord, ne laissait voir ni le titre finir son
 * apparition ni un seul relais de nom (l'intervalle entre deux noms était
 * même plus long que tout le plancher) : le rideau donnait l'impression de
 * clignoter plutôt que de se montrer. 2800 ms laisse le temps de deux
 * relais.
 */
const FIRST_VISIT_MS = 2800;
const RETURNING_MS = 500;
const EXIT_MS = 620;

const SEEN_KEY = 'arbre:ouverture-vue';

function isReturning(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Stockage refusé : on traite comme un retour, pour ne pas infliger la
    // scène longue à chaque fois sans pouvoir s'en souvenir.
    return true;
  }
}

/**
 * Rideau d'ouverture.
 *
 * Une seule chose bouge : l'emblème de la famille — le même losange à trois
 * points que la barre du haut, agrandi et posé au milieu d'un halo qui
 * respire. Une version précédente y ajoutait un éventail de trente et un
 * médaillons, des étincelles courant sur chaque lien et de la poussière
 * flottante ; le résultat donnait moins l'impression d'un accueil que d'un
 * feu d'artifice, et coûtait cher à faire tourner pour ce que ça disait. Un
 * seul repère qui respire, un nom, un trait de progression : c'est tout ce
 * qu'un écran d'attente a besoin de dire.
 */
export function LoadingScreen({
  ready,
  title,
  names = [],
  people = 0,
  generations = 0,
}: LoadingScreenProps) {
  const [mounted, setMounted] = useState(true);
  const [floorPassed, setFloorPassed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [nameIndex, setNameIndex] = useState(0);

  /*
   * A-t-on déjà vu le rideau ? Lu une seule fois, à l'instant du montage —
   * jamais recalculé dans l'effet ci-dessous.
   *
   * L'ancienne version lisait ET écrivait `SEEN_KEY` dans le même effet. En
   * développement, StrictMode monte chaque composant deux fois de suite pour
   * détecter les effets mal nettoyés : la première invocation écrivait déjà
   * « vu » avant que la seconde ne relise la valeur — qui se retrouvait donc
   * toujours à « vu », même au tout premier chargement. Un initialiseur de
   * state ne fait QUE lire, sans jamais écrire : les deux passages de
   * StrictMode y lisent la même chose, avant qu'aucune écriture n'ait eu
   * lieu.
   */
  const [wasReturning] = useState(isReturning);

  useEffect(() => {
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduced(quiet);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* voir `isReturning` */
    }
    if (quiet) {
      setFloorPassed(true);
      return undefined;
    }
    const floor = wasReturning ? RETURNING_MS : FIRST_VISIT_MS;
    const timer = window.setTimeout(() => setFloorPassed(true), floor);
    return () => window.clearTimeout(timer);
  }, [wasReturning]);

  // Un seul nom à la fois, qui cède doucement la place au suivant.
  useEffect(() => {
    if (reduced || names.length < 2) return undefined;
    const timer = window.setInterval(
      () => setNameIndex((index) => (index + 1) % names.length),
      1300,
    );
    return () => window.clearInterval(timer);
  }, [reduced, names.length]);

  const leaving = ready && floorPassed;

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const caption = useMemo(() => {
    if (people === 0) return '';
    const gen = generations > 0 ? `${generations} générations` : '';
    return [`${people} personnes`, gen].filter(Boolean).join(' · ');
  }, [people, generations]);

  if (!mounted) return null;

  return (
    <div
      className="loading-screen"
      data-leaving={leaving || undefined}
      data-reduced={reduced || undefined}
      aria-hidden={leaving || undefined}
      role="status"
      aria-live="polite"
    >
      <div className="ls-emblem">
        <span className="ls-emblem-glow" aria-hidden="true" />
        <span className="ls-emblem-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="ls-titles">
        <h1 className="ls-title">{title || 'Arbre généalogique'}</h1>

        {(names.length > 0 || caption) && (
          <div className="ls-names" aria-hidden="true">
            {names.length > 0
              ? names.map((name, index) => (
                  <span
                    key={name + index}
                    className="ls-name"
                    data-active={index === nameIndex || undefined}
                  >
                    {name}
                  </span>
                ))
              : (
                <span className="ls-name" data-active>
                  {caption}
                </span>
              )}
          </div>
        )}

        <div className="ls-progress" aria-hidden="true">
          <span className="ls-progress-fill" />
        </div>
      </div>
    </div>
  );
}
