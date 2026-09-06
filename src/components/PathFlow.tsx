import { useMemo } from 'react';
import type { TreeLayout } from '@/domain/layout';
import type { RelationPath } from '@/domain/relations';
import { CARD_HEIGHT, ROW_HEIGHT, cardCenterX, cardTop, portraitCenterY } from '@/view/metrics';

export interface PathFlowProps {
  layout: TreeLayout;
  relation?: RelationPath;
}

/** Même formule que le bus des liens de filiation (voir `view/links.ts`) : la
 *  goutte doit longer le trait réellement dessiné, pas le couper au plus
 *  court à travers le feuillage. */
const BUS_LIFT = (ROW_HEIGHT - CARD_HEIGHT) * 0.5;

/**
 * La part du chemin que l'encre occupe à un instant donné.
 *
 * Assez longue pour qu'on voie d'où elle vient, assez courte pour qu'on
 * distingue encore sa tête : au-delà d'un quart, le trait se referme sur
 * lui-même et le sens du parcours se perd — ce qui était toute la raison
 * d'être de cette animation.
 */
const PART_ENCREE = 0.18;

/** Unités du monde par seconde. Une vitesse, pas une durée : un chemin deux
 *  fois plus long met deux fois plus de temps, comme la sève. */
const VITESSE = 900;
const DUREE_MIN = 1.4;
const DUREE_MAX = 4.5;

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * L'encre qui parcourt une filiation.
 *
 * Le chemin de parenté est déjà tracé en accent sur le canevas des liens
 * (voir `LinkLayer`) et énuméré en toutes lettres dans la fiche (voir
 * `detail-path`). Ce troisième témoin répond à une question que ni l'un ni
 * l'autre ne montre : le SENS du parcours — remonter une lignée puis en
 * redescendre une autre n'est pas la même chose qu'un trait accentué.
 *
 * ── Ce qu'il y avait avant ─────────────────────────────────────────────
 *
 * Trois points lumineux, bleu, rose et orange, chacun portant deux
 * `drop-shadow`, qui se couraient après en boucle. Trois défauts d'un coup :
 * deux de ces teintes n'existent pas dans la doctrine de la planche, six
 * filtres tournaient en permanence sur des éléments animés, et trois points
 * qui se poursuivent ne se lisent pas comme un parcours mais comme un
 * indicateur de chargement.
 *
 * ── Ce que c'est devenu ────────────────────────────────────────────────
 *
 * UN seul trait, court, qui court le long du chemin : le tracé est dessiné en
 * pointillé d'un unique tiret long d'un cinquième du parcours, dont on anime
 * le décalage. Sa tête est arrondie — c'est elle, la goutte. Il n'y a donc
 * rien à synchroniser : le point et sa traînée sont le même objet.
 *
 * ── Pourquoi il est LARGE et pâle ──────────────────────────────────────
 *
 * Premier essai : un trait de bleu de Prusse, fin, par-dessus le chemin. Or
 * ce chemin est DÉJÀ tracé en noir franc sur le canevas des liens — du bleu
 * sombre sur du noir ne se voit pas. Vérifié à l'écran : l'animation tournait
 * (le décalage relevé valait −370 sur une plage allant de 118 à −540) et l'on
 * ne voyait rigoureusement rien.
 *
 * Le trait est donc plus LARGE que le lien qu'il suit, et pâle : il déborde
 * de part et d'autre du noir, comme une auréole d'encre fraîche autour d'un
 * trait sec. Il se lit aussi bien sur le noir que sur le papier nu — ce qui
 * compte, car le chemin passe par le centre des portraits là où les liens
 * passent par le bord des cartes : les deux ne se recouvrent pas partout.
 *
 * `vector-effect: non-scaling-stroke` : l'épaisseur est en pixels d'écran,
 * comme celle des liens. Sans lui, l'auréole grossirait avec le zoom et
 * finirait par noyer les cartes.
 */
export function PathFlow({ layout, relation }: PathFlowProps) {
  const trace = useMemo(() => {
    if (!relation || relation.steps.length < 2) return null;
    const segments: string[] = [];
    let longueur = 0;
    let dernier: { x: number; y: number } | null = null;

    /** Ajoute un sommet au tracé ET à sa longueur : les deux ne doivent jamais
     *  diverger, faute de quoi le tiret ne couvrirait plus le bon chemin. */
    const jusqua = (x: number, y: number): void => {
      if (dernier) longueur += Math.hypot(x - dernier.x, y - dernier.y);
      dernier = { x, y };
    };

    for (let i = 1; i < relation.steps.length; i += 1) {
      const previous = layout.positions.get(relation.steps[i - 1].id);
      const step = layout.positions.get(relation.steps[i].id);
      if (!previous || !step) continue;

      const x1 = cardCenterX(previous.x);
      const y1 = portraitCenterY(previous.y);
      const x2 = cardCenterX(step.x);
      const y2 = portraitCenterY(step.y);

      if (segments.length === 0) {
        segments.push(`M ${x1} ${y1}`);
        dernier = { x: x1, y: y1 };
      }

      if (relation.steps[i].direction === 'spouse') {
        // Conjoints : le trait d'alliance est un segment droit entre les deux
        // portraits, à la même hauteur.
        segments.push(`L ${x2} ${y2}`);
        jusqua(x2, y2);
        continue;
      }

      // Filiation : un coude par le corridor du distributeur, à la hauteur où
      // le lien réel bifurque — sous la rangée de l'enfant, entre les deux
      // générations.
      const childY = Math.max(previous.y, step.y);
      const busY = cardTop(childY) - BUS_LIFT;
      segments.push(`L ${x1} ${busY}`, `L ${x2} ${busY}`, `L ${x2} ${y2}`);
      jusqua(x1, busY);
      jusqua(x2, busY);
      jusqua(x2, y2);
    }

    if (segments.length === 0 || longueur <= 0) return null;
    return { d: segments.join(' '), longueur };
  }, [layout, relation]);

  if (!trace) return null;

  const calm = reducedMotion();
  const tiret = trace.longueur * PART_ENCREE;
  const duree = Math.min(DUREE_MAX, Math.max(DUREE_MIN, trace.longueur / VITESSE));

  return (
    <svg className="path-flow" aria-hidden="true">
      <path className="path-flow-track" d={trace.d} />
      {!calm && (
        <>
          <path
            className="path-flow-encre"
            d={trace.d}
            strokeDasharray={`${tiret} ${trace.longueur}`}
          >
            <animate
              attributeName="stroke-dashoffset"
              from={tiret}
              to={tiret - trace.longueur}
              dur={`${duree}s`}
              repeatCount="indefinite"
            />
            {/* Chaque passage s'efface avant le suivant : sans cela, la reprise
                se verrait comme un saut, l'encre disparaissant d'un bout pour
                reparaître à l'autre. */}
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.14;0.8;1"
              dur={`${duree}s`}
              repeatCount="indefinite"
            />
          </path>
        </>
      )}
    </svg>
  );
}
