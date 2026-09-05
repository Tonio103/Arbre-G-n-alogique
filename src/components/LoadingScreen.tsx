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
 * Combien de temps le rideau reste, au minimum — toujours le même, à chaque
 * ouverture.
 *
 * Une version distinguait « première visite » (le temps de lire) et
 * « retour » (500 ms, presque rien) grâce à un drapeau posé dans le
 * navigateur. Mais cette application se rouvre sans cesse, par la même
 * personne, sur le même poste : le drapeau se pose dès la toute première
 * ouverture et reste ensuite posé pour de bon — TOUTES les visites qui
 * suivent, à vie, tombaient donc sur les 500 ms, un simple flash. Un rideau
 * qu'on ne voit jamais ne sert à rien : autant qu'il dure pareil pour tout le
 * monde, assez longtemps pour se lire.
 */
const DISPLAY_MS = 2800;
const EXIT_MS = 620;

/**
 * Rideau d'ouverture : la page de garde de l'album.
 *
 * Un papier marbré de relieur en fond — la vraie garde d'un volume relié —,
 * et par-dessus un cartouche gravé qui porte le nom de la famille. Le titre
 * est posé dans la RÉSERVE du cartouche, jamais sur le marbré : un motif de
 * cuve est trop actif pour qu'on lise par-dessus, et c'est exactement pour ça
 * qu'un relieur colle une étiquette de papier uni sur ses plats.
 *
 * Ce qu'il y avait avant : un losange à coins arrondis, rempli d'un dégradé
 * bleu vers rose, qui respirait. C'était l'icône d'une application moderne au
 * milieu d'une planche d'herbier — la dernière pièce de l'ancienne identité,
 * et la première chose que voyait quiconque ouvrait l'arbre.
 *
 * Une version antérieure y ajoutait un éventail de trente et un médaillons,
 * des étincelles courant sur chaque lien et de la poussière flottante ; le
 * résultat donnait moins l'impression d'un accueil que d'un feu d'artifice.
 * Ici rien ne respire : le cartouche s'encre une fois, en s'approchant, comme
 * une planche qu'on vient de tirer.
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

  useEffect(() => {
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduced(quiet);
    if (quiet) {
      setFloorPassed(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setFloorPassed(true), DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

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
      {/* Le cartouche : la gravure en masque, la réserve de papier dessous,
          et le titre au centre de l'ovale. */}
      <div className="ls-plaque">
        <span className="ls-reserve" aria-hidden="true" />
        <span className="ls-cartouche ornement ornement--cartouche" aria-hidden="true" />
        <h1 className="ls-title">{title || 'Arbre généalogique'}</h1>
      </div>

      <div className="ls-titles">
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

        <span className="ls-filet ornement ornement--filet-fort" aria-hidden="true" />

        <div className="ls-progress" aria-hidden="true">
          <span className="ls-progress-fill" />
        </div>
      </div>
    </div>
  );
}
