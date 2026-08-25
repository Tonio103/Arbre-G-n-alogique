import { useMemo } from 'react';
import type { TreeLayout } from '@/domain/layout';
import type { RelationPath } from '@/domain/relations';
import { CARD_HEIGHT, ROW_HEIGHT, cardCenterX, cardTop, portraitCenterY } from '@/view/metrics';

export interface PathFlowProps {
  layout: TreeLayout;
  relation?: RelationPath;
}

/** Même formule que le bus des liens de filiation (voir `view/links.ts`) : la
 *  lumière doit longer le trait réellement dessiné, pas le couper au plus
 *  court à travers le feuillage. */
const BUS_LIFT = (ROW_HEIGHT - CARD_HEIGHT) * 0.5;

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * La lumière qui parcourt une filiation.
 *
 * Le chemin de parenté est déjà tracé en accent sur le canevas des liens
 * (voir `LinkLayer`) et énuméré en toutes lettres dans la fiche (voir
 * `detail-path`). Ce troisième témoin répond à une question que ni l'un ni
 * l'autre ne montre : le sens du parcours, et son mouvement — remonter une
 * lignée puis en redescendre une autre n'est pas la même chose qu'un simple
 * trait accentué.
 *
 * Portée par `<animateMotion>` le long d'un chemin SVG recalculé une seule
 * fois par sélection : aucune boucle image par image ne tourne côté
 * JavaScript, le rendu est laissé au moteur du navigateur.
 */
export function PathFlow({ layout, relation }: PathFlowProps) {
  const path = useMemo(() => {
    if (!relation || relation.steps.length < 2) return null;
    const segments: string[] = [];

    for (let i = 1; i < relation.steps.length; i += 1) {
      const previous = layout.positions.get(relation.steps[i - 1].id);
      const step = layout.positions.get(relation.steps[i].id);
      if (!previous || !step) continue;

      const x1 = cardCenterX(previous.x);
      const y1 = portraitCenterY(previous.y);
      const x2 = cardCenterX(step.x);
      const y2 = portraitCenterY(step.y);

      if (segments.length === 0) segments.push(`M ${x1} ${y1}`);

      if (relation.steps[i].direction === 'spouse') {
        // Conjoints : le trait d'alliance est un segment droit entre les deux
        // portraits, à la même hauteur.
        segments.push(`L ${x2} ${y2}`);
        continue;
      }

      // Filiation : un coude par le corridor du distributeur, à la hauteur où
      // le lien réel bifurque — sous la rangée de l'enfant, entre les deux
      // générations.
      const childY = Math.max(previous.y, step.y);
      const busY = cardTop(childY) - BUS_LIFT;
      segments.push(`L ${x1} ${busY}`, `L ${x2} ${busY}`, `L ${x2} ${y2}`);
    }

    return segments.length > 0 ? segments.join(' ') : null;
  }, [layout, relation]);

  if (!path) return null;

  const calm = reducedMotion();

  return (
    <svg className="path-flow" aria-hidden="true">
      <path className="path-flow-track" d={path} />
      {!calm && (
        <>
          <circle className="path-flow-spark" r="3.6">
            <animateMotion dur="2.4s" begin="0s" repeatCount="indefinite" path={path} rotate="auto" />
          </circle>
          <circle className="path-flow-spark path-flow-spark--b" r="3.6">
            <animateMotion dur="2.4s" begin="-0.8s" repeatCount="indefinite" path={path} rotate="auto" />
          </circle>
          <circle className="path-flow-spark path-flow-spark--c" r="3.6">
            <animateMotion dur="2.4s" begin="-1.6s" repeatCount="indefinite" path={path} rotate="auto" />
          </circle>
        </>
      )}
    </svg>
  );
}
