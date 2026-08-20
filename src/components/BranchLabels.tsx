import { useEffect, useRef } from 'react';
import type { LayoutRegion } from '@/domain/layout';
import type { ViewportController } from '@/view/viewport';

export interface BranchLabelsProps {
  regions: LayoutRegion[];
  viewport: ViewportController;
  onFocusRegion: (region: LayoutRegion) => void;
}

/** En dessous de ce zoom, les noms sur les cartes ne sont plus lisibles. */
const SHOW_BELOW = 0.34;
/** Marge entre deux étiquettes voisines avant de considérer qu'elles se gênent. */
/** Au-delà, les étiquettes cachent plus d'arbre qu'elles n'en expliquent. */
const MAX_LABELS = 3;

const LABEL_GAP = 12;

/**
 * Noms des branches familiales, affichés en vue éloignée.
 *
 * Positionnés en pixels écran à chaque image plutôt que dans le monde
 * transformé : le texte garde ainsi sa taille lisible quel que soit le zoom,
 * et la couche ne coûte qu'une poignée d'écritures de style.
 */
export function BranchLabels({ regions, viewport, onFocusRegion }: BranchLabelsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const widthsRef = useRef<number[]>([]);

  // Largeurs mesurées une seule fois : les relire à chaque image forcerait un
  // recalcul de mise en page à 60 Hz.
  useEffect(() => {
    widthsRef.current = itemsRef.current.map((element) => element?.offsetWidth ?? 160);
  }, [regions]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let frame = 0;

    // Les branches les plus peuplées gardent la priorité d'affichage.
    const order = regions
      .map((region, index) => ({ region, index }))
      .sort((a, b) => b.region.count - a.region.count);

    const apply = (): void => {
      frame = 0;
      const { x, y, scale } = viewport.transform;
      const visible = scale < SHOW_BELOW;
      container.dataset.visible = visible ? 'true' : 'false';
      if (!visible) return;

      const { width, height } = viewport.size;
      const taken: Array<{ left: number; right: number; top: number }> = [];
      // Les étiquettes se posent devant la ramure : au-delà de quelques-unes,
      // elles masquent l'arbre qu'elles sont censées aider à lire. `order` étant
      // trié par importance, on garde les branches les plus fournies.
      let shown = 0;

      for (const { region, index } of order) {
        const element = itemsRef.current[index];
        if (!element) continue;

        const hide = (): void => {
          element.style.opacity = '0';
          element.style.pointerEvents = 'none';
        };

        const screenX = region.centerX * scale + x;
        const screenY = region.y * scale + y;
        const screenWidth = (region.maxX - region.minX) * scale;

        const offscreen =
          screenX < -220 || screenX > width + 220 || screenY < -400 || screenY > height + 400;
        if (offscreen || screenWidth < 54) {
          hide();
          continue;
        }

        if (shown >= MAX_LABELS) {
          hide();
          continue;
        }

        const labelWidth = widthsRef.current[index] || 160;
        const left = screenX - labelWidth / 2;
        const right = screenX + labelWidth / 2;
        // Le test de chevauchement est volontairement large en hauteur : les
        // branches d'une même lignée partagent la même abscisse, et des
        // étiquettes séparées de quelques dizaines de pixels s'empilent en
        // escalier devant la ramure qu'elles désignent.
        const overlaps = taken.some(
          (slot) =>
            Math.abs(slot.top - screenY) < 110 &&
            left < slot.right + LABEL_GAP &&
            right > slot.left - LABEL_GAP,
        );
        if (overlaps) {
          hide();
          continue;
        }

        taken.push({ left, right, top: screenY });
        shown += 1;
        element.style.opacity = '1';
        element.style.pointerEvents = 'auto';
        element.style.transform = `translate3d(${Math.round(screenX)}px, ${Math.round(screenY)}px, 0) translate(-50%, -100%)`;
      }
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
  }, [regions, viewport]);

  if (regions.length === 0) return null;

  return (
    <div className="branches" ref={containerRef} data-visible="false">
      {regions.map((region, index) => (
        <button
          type="button"
          key={region.anchorId}
          className="branch-label lg lg--chip lg--interactive"
          ref={(element) => {
            itemsRef.current[index] = element;
          }}
          onClick={(event) => {
            event.stopPropagation();
            onFocusRegion(region);
          }}
          title={`${region.label} — ${region.count} personnes`}
        >
          <span className="branch-name">{region.label}</span>
          <span className="branch-count">{region.count}</span>
        </button>
      ))}
    </div>
  );
}
