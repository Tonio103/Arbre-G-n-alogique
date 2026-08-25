import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/**
 * Vrai quand le panneau de détails doit s'afficher en feuille basse.
 *
 * Deux cas déclenchent la mise en page compacte : un écran étroit (un
 * téléphone, quelle que soit son orientation), ou un écran tenu à la
 * verticale même large — une tablette ou un moniteur en portrait. Dans ce
 * second cas, la largeur seule ne suffit pas à décider : une tablette de
 * 1024px de large en portrait a largement la place d'un panneau latéral de
 * 400px sur le papier, mais un panneau qui mange le tiers d'une colonne déjà
 * étroite s'y sent à l'étroit — la feuille basse, qui prend toute la largeur
 * et laisse l'arbre respirer au-dessus, convient mieux à ce format.
 */
export function useIsCompact(): boolean {
  return useMediaQuery('(max-width: 860px), (orientation: portrait) and (max-width: 1024px)');
}
