import { useEffect, useRef } from 'react';
import type { ViewportController } from '@/view/viewport';

export interface BackdropProps {
  viewport: ViewportController;
}

/** Amplitude maximale de la parallaxe, en pixels — voir `inset` dans app.css. */
const MAX_SHIFT = 64;

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

    const apply = (): void => {
      frame = 0;
      const { x, y, scale } = viewport.transform;
      // Déplacement très amorti, et surtout borné : sur un arbre large de
      // dizaines de milliers de pixels, un décalage proportionnel finirait par
      // sortir le décor du cadre et découvrir le fond nu.
      const offsetX = clamp(x * 0.035, MAX_SHIFT);
      const offsetY = clamp(y * 0.035, MAX_SHIFT);
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
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [viewport]);

  return <div ref={layerRef} className="backdrop" aria-hidden="true" />;
}
