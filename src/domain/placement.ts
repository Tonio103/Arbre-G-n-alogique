import type { FamilyGraph } from './graph';
import type { NodePosition } from './layout';
import { CARD_WIDTH, COUPLE_GAP, FAMILY_GAP, ROW_HEIGHT, SIBLING_GAP } from '@/view/metrics';

/*
 * ============================================================================
 *
 *  LA FICHE DE FAMILLE
 *
 *  On ne dessine plus l'arbre entier, mais une seule famille à la fois —
 *  celle de la personne regardée — et on passe de l'une à l'autre en cliquant.
 *
 *  Ce choix règle définitivement ce qu'aucun algorithme n'était parvenu à
 *  régler ici. Placer cinq cents personnes d'un coup revient à dessiner un
 *  graphe orienté sans circuit : une personne mariée appartient à deux
 *  familles — celle de ses parents et celle de son conjoint — et les deux
 *  tirent sur elle. Quel que soit l'arbitrage, il reste de longs traits
 *  horizontaux et des croisements ; on l'a mesuré sur les vraies données, avec
 *  les bandes comme avec Sugiyama.
 *
 *  Quatre rangées d'une quinzaine de personnes, en revanche, se placent sans
 *  la moindre ambiguïté :
 *
 *      grands-parents      ( · · )        ( · · )
 *      parents                  ( · · )
 *      la personne, sa fratrie, son conjoint
 *      enfants
 *
 *  Chaque rangée est centrée sur celle du dessous. Aucun trait ne peut en
 *  croiser un autre : il n'y a jamais deux familles côte à côte pour se
 *  disputer la même rangée. C'est la lecture d'un acte d'état civil, et c'est
 *  ce que font les sites de généalogie pour la même raison.
 *
 * ==========================================================================*/

export interface Placement {
  positions: Map<string, NodePosition>;
}

/** Pas d'une carte à la suivante à l'intérieur d'un couple. */
const COUPLE_STEP = CARD_WIDTH + COUPLE_GAP;
/** Pas d'un frère ou d'une sœur au suivant. */
const SIBLING_STEP = CARD_WIDTH + SIBLING_GAP;

const widthOf = (count: number): number =>
  count * CARD_WIDTH + Math.max(0, count - 1) * COUPLE_GAP;

/** Ordonne une fratrie par année de naissance : l'ordre où on la récite. */
function byBirth(graph: FamilyGraph, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ya = graph.people.get(a)?.birthYear ?? Number.MAX_SAFE_INTEGER;
    const yb = graph.people.get(b)?.birthYear ?? Number.MAX_SAFE_INTEGER;
    return ya - yb || a.localeCompare(b);
  });
}

/** Une rangée en cours de construction : des cartes déjà posées. */
interface Placed {
  ids: string[];
  left: number;
  right: number;
}

/**
 * Pose une suite de cartes accolées — un couple, une fratrie — à partir de
 * `left`, et rend l'étendue occupée.
 */
function place(
  ids: string[],
  left: number,
  generation: number,
  step: number,
  positions: Map<string, NodePosition>,
): Placed {
  let cursor = left;
  for (const id of ids) {
    positions.set(id, { id, x: cursor, y: generation * ROW_HEIGHT, generation });
    cursor += step;
  }
  return { ids, left, right: cursor - step + CARD_WIDTH };
}

const centre = (span: Placed): number => (span.left + span.right) / 2;

/** Les parents connus d'une personne, dans un ordre stable. */
function parentsOf(graph: FamilyGraph, id: string): string[] {
  return (graph.people.get(id)?.parents ?? []).filter((parentId) => graph.people.has(parentId));
}

/**
 * Les conjoints d'une personne, encadrant celle-ci quand il y en a plusieurs.
 *
 * Un remariage laisse la personne au milieu : posée en tête, elle ne serait
 * voisine que du premier conjoint, et le trait vers le second devrait enjamber
 * le premier.
 */
function withSpouses(graph: FamilyGraph, id: string, taken: Set<string>): string[] {
  const spouses: string[] = [];
  for (const link of graph.people.get(id)?.spouseLinks ?? []) {
    if (taken.has(link.id) || !graph.people.has(link.id)) continue;
    taken.add(link.id);
    spouses.push(link.id);
  }
  if (spouses.length === 0) return [id];
  if (spouses.length === 1) return [id, spouses[0]];
  return [spouses[0], id, ...spouses.slice(1)];
}

/**
 * Place la famille de `focusId` : ses grands-parents, ses parents, sa fratrie
 * et son conjoint, ses enfants.
 *
 * Les rangées se construisent de bas en haut, chacune centrée sur ce dont elle
 * descend — c'est ce qui garantit qu'aucun trait ne part de travers.
 */
export function computePlacement(graph: FamilyGraph, focusId?: string): Placement {
  const positions = new Map<string, NodePosition>();

  const focus =
    focusId && graph.people.has(focusId)
      ? focusId
      : graph.people.has(graph.rootId)
        ? graph.rootId
        : graph.order[0];
  if (!focus) return { positions };

  const person = graph.people.get(focus)!;
  const generation = person.generation;
  // Une personne déjà posée ne peut pas l'être une seconde fois : un cousin
  // germain épousé, et la même carte se retrouverait à deux endroits.
  const taken = new Set<string>([focus]);

  /*
   * ── La rangée de la personne ────────────────────────────────────────────
   *
   * Sa fratrie dans l'ordre des naissances, elle-même à sa place dedans, et
   * son conjoint accolé à elle.
   */
  const siblings = byBirth(graph, [focus, ...person.siblings.filter((id) => graph.people.has(id))]);

  let cursor = 0;
  let selfLeft = 0;
  let coupleRight = 0;
  let siblingsLeft = Number.POSITIVE_INFINITY;
  let siblingsRight = Number.NEGATIVE_INFINITY;

  for (const id of siblings) {
    if (id !== focus && taken.has(id)) continue;
    taken.add(id);

    // Seule la personne regardée montre son conjoint : afficher aussi ceux de
    // toute la fratrie doublerait la largeur pour des gens qu'on ne consulte
    // pas. Un clic sur un frère ouvre sa propre fiche, avec le sien.
    const cell = id === focus ? withSpouses(graph, id, taken) : [id];
    const span = place(cell, cursor, generation, COUPLE_STEP, positions);

    siblingsLeft = Math.min(siblingsLeft, span.left);
    siblingsRight = Math.max(siblingsRight, span.left + CARD_WIDTH);
    if (id === focus) {
      selfLeft = positions.get(focus)!.x;
      coupleRight = span.right;
    }
    cursor = span.right + SIBLING_GAP;
  }

  const siblingsSpan: Placed = { ids: siblings, left: siblingsLeft, right: siblingsRight };

  /*
   * ── Les parents ─────────────────────────────────────────────────────────
   *
   * Centrés sur la fratrie entière, puisque c'est d'eux qu'elle descend —
   * et non sur la seule personne regardée, ce qui ferait pencher le trait.
   * Le conjoint, lui, ne compte pas : il n'est pas leur enfant.
   */
  const parents = parentsOf(graph, focus).filter((id) => !taken.has(id));
  for (const id of parents) taken.add(id);

  if (parents.length > 0) {
    const ordered = byBirth(graph, parents);
    place(
      ordered,
      centre(siblingsSpan) - widthOf(ordered.length) / 2,
      generation - 1,
      COUPLE_STEP,
      positions,
    );

    /*
     * ── Les grands-parents ────────────────────────────────────────────────
     *
     * Chaque couple au-dessus de son enfant. Deux couples au-dessus de deux
     * parents voisins se recouvriraient : on les écarte alors de part et
     * d'autre, à égale distance, pour que chacun garde son trait droit et que
     * l'ensemble reste centré.
     */
    const blocks: Array<{ ids: string[]; want: number; wish: number; width: number }> = [];
    for (const parentId of ordered) {
      const grandparents = byBirth(
        graph,
        parentsOf(graph, parentId).filter((id) => !taken.has(id)),
      );
      if (grandparents.length === 0) continue;
      for (const id of grandparents) taken.add(id);
      const width = widthOf(grandparents.length);
      const want = positions.get(parentId)!.x + CARD_WIDTH / 2 - width / 2;
      blocks.push({ ids: grandparents, want, wish: want, width });
    }

    /*
     * Deux couples de grands-parents ne tiennent pas au-dessus de deux parents
     * accolés : il leur faut 218 pixels quand les parents n'en occupent que
     * 176. On les écarte donc de la gauche vers la droite, puis on ramène
     * l'ensemble sur le milieu VOULU — celui d'avant l'écartement.
     *
     * Sans ce retour au centre, tout le décalage retombait sur le dernier
     * couple : les grands-parents maternels étaient parfaitement centrés sur
     * leur fille, et les paternels à cent trente pixels de leur fils. Réparti,
     * chacun s'écarte de soixante-cinq, le dessin est symétrique, et les deux
     * traits penchent pareil — ce qui se lit comme un choix, pas comme une
     * erreur.
     */
    blocks.sort((a, b) => a.want - b.want);
    let edge = Number.NEGATIVE_INFINITY;
    for (const block of blocks) {
      block.wish = Math.max(block.want, edge);
      edge = block.wish + block.width + FAMILY_GAP;
    }
    if (blocks.length > 0) {
      const last = blocks.length - 1;
      const wanted = (blocks[0].want + blocks[last].want + blocks[last].width) / 2;
      const actual = (blocks[0].wish + blocks[last].wish + blocks[last].width) / 2;
      const shift = wanted - actual;
      for (const block of blocks) {
        place(block.ids, block.wish + shift, generation - 2, COUPLE_STEP, positions);
      }
    }
  }

  /*
   * ── Les enfants ─────────────────────────────────────────────────────────
   *
   * Centrés sous le couple, pas sous la seule personne regardée : le trait de
   * descendance part du milieu du trait d'alliance.
   */
  const children = byBirth(
    graph,
    (person.children ?? []).filter((id) => graph.people.has(id) && !taken.has(id)),
  );
  if (children.length > 0) {
    for (const id of children) taken.add(id);
    const width = children.length * CARD_WIDTH + (children.length - 1) * SIBLING_GAP;
    const middle = (selfLeft + coupleRight) / 2;
    place(children, middle - width / 2, generation + 1, SIBLING_STEP, positions);
  }

  // Tout ramener dans le quadrant positif : le cadre part de l'origine.
  let minX = Number.POSITIVE_INFINITY;
  for (const node of positions.values()) minX = Math.min(minX, node.x);
  if (Number.isFinite(minX) && minX !== 0) {
    for (const node of positions.values()) node.x -= minX;
  }

  return { positions };
}
