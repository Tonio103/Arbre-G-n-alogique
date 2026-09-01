import { useEffect, useRef } from 'react';

/** Le même délai que la suspension du verre pendant un glissé de l'arbre
 *  (voir `TreeCanvas.tsx`) : assez court pour rester invisible, assez long
 *  pour ne pas se rallumer entre deux images d'un défilement soutenu. */
const SETTLE_MS = 200;

/**
 * Suspend le flou des plaques de verre pendant qu'on fait défiler leur
 * conteneur.
 *
 * Douze cartes de manques, ou toute la frise et ses notes, vivent dans une
 * même colonne qui défile nativement (`.view`, `overflow-y: auto`). Un
 * défilement déplace chacune de ces plaques par rapport à l'écran à chaque
 * image — et un flou d'arrière-plan échantillonne ce qu'il y a dessous à
 * CHAQUE image, quel que soit le nombre de plaques concernées. C'est
 * exactement la même dépense que celle déjà trouvée sur les médaillons de
 * l'arbre pendant un glissé, seulement derrière un geste natif (le
 * défilement du navigateur) plutôt qu'un `transform` piloté à la main.
 *
 * `data-scrolling`, posé sur le conteneur qui défile, suspend ce flou-là —
 * lui seul, la teinte et l'arête restent, ce sont des dégradés qui ne
 * coûtent rien de plus en mouvement (voir la règle dans `liquid-glass.css`).
 */
export function useGlassScrollSuspend<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let timer = 0;
    const onScroll = (): void => {
      el.setAttribute('data-scrolling', '');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => el.removeAttribute('data-scrolling'), SETTLE_MS);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
      el.removeAttribute('data-scrolling');
    };
  }, []);

  return ref;
}
