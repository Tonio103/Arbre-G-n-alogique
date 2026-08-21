import { useEffect, useRef } from 'react';
import type { ViewportController } from '@/view/viewport';

export interface BackdropProps {
  viewport: ViewportController;
}

/**
 * Amplitude maximale de la parallaxe, en pixels.
 *
 * Elle s'ajoute à la dérive propre du fond (26 px au plus). La somme des deux
 * doit rester sous le débord de la couche — `inset: -80px` dans app.css — sinon
 * le décor finit par découvrir son bord au coin de l'écran.
 */
const MAX_SHIFT = 40;

const clamp = (value: number, limit: number): number =>
  Math.max(-limit, Math.min(limit, value));

/**
 * Décor : halos colorés et vignette, en parallaxe très amortie.
 *
 * Volontairement hors de la zone de navigation. Tant que ce fond vivait sous
 * l'élément transformé, le navigateur repeignait toute la surface à chaque
 * image de déplacement — près de la moitié du budget d'affichage. En couche
 * fixe et isolée, il est peint une fois puis simplement recomposé.
 */
export function Backdrop({ viewport }: BackdropProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;
    let frame = 0;
    let drift = 0;

    const apply = (): void => {
      frame = 0;
      const { x, y, scale } = viewport.transform;
      // Déplacement très amorti, et surtout borné : sur un arbre large de
      // dizaines de milliers de pixels, un décalage proportionnel finirait par
      // sortir le décor du cadre et découvrir le fond nu.
      // La dérive propre du fond, ajoutée à la parallaxe.
      //
      // Elle tient dans la même transformation, sur la même couche : une nappe
      // de plus, si discrète soit-elle, doublait le coût du flou d'arrière-plan
      // de toute l'interface — chaque surface de verre doit refondre son fond,
      // et ce fond aurait compté une épaisseur de plus.
      //
      // Deux périodes incommensurables, donc un parcours qui ne se referme
      // jamais : la lumière du décor n'est jamais tout à fait la même qu'il y a
      // une minute, et jamais assez différente pour qu'on la surprenne à
      // bouger.
      const offsetX =
        clamp(x * 0.035, MAX_SHIFT) + Math.sin(drift * 0.021) * 26;
      const offsetY =
        clamp(y * 0.035, MAX_SHIFT) + Math.sin(drift * 0.0135 + 2.2) * 18;
      // Jamais en dessous de 1 : réduire la couche découvrirait ses bords.
      const zoom = Math.max(1, 1 + (scale - 1) * 0.02);
      layer.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${zoom})`;
    };

    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    const unsubscribe = viewport.subscribe(schedule);

    // Cinq images par seconde suffisent à une dérive de cette lenteur — un
    // demi-pixel par pas — et c'est cinq fois moins de recompositions que la
    // même animation confiée au navigateur.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ticker = calm
      ? 0
      : window.setInterval(() => {
          drift += 0.2;
          schedule();
        }, 200);

    return () => {
      unsubscribe();
      window.clearInterval(ticker);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [viewport]);

  return <div ref={layerRef} className="backdrop" aria-hidden="true" />;
}
