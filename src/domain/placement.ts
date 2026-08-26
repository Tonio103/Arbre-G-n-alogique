import type { FamilyGraph } from './graph';
import type { NodePosition } from './layout';
import { CARD_WIDTH, COUPLE_GAP, FAMILY_GAP, ROW_HEIGHT, SIBLING_GAP } from '@/view/metrics';

/*
 * ============================================================================
 *
 *  LE PLACEMENT
 *
 *  Une seule règle, tenue de bout en bout : chaque famille possède une bande
 *  horizontale qui n'appartient qu'à elle, et où nulle autre n'entre.
 *
 *  Tout en découle. Deux cartes ne peuvent pas se recouvrir, puisqu'elles sont
 *  dans des bandes disjointes. Une fratrie tombe exactement sous ses parents,
 *  puisque les parents se centrent sur la bande de leurs enfants. Deux traits
 *  de filiation ne peuvent pas se croiser, puisque les bandes qu'ils relient
 *  ne se chevauchent jamais.
 *
 *  Ces propriétés sont acquises *par construction*. Une version précédente les
 *  poursuivait à l'inverse, en corrigeant après coup un placement approximatif
 *  — écarter ce qui se recouvre, réordonner pour décroiser, recentrer les
 *  familles — et chaque correction défaisait un peu la précédente. Le prix à
 *  payer ici est un arbre plus large : une bande réservée n'est pas toujours
 *  remplie. C'est un prix qu'on peut payer, l'espace horizontal ne coûtant
 *  qu'un peu de défilement.
 *
 * ==========================================================================*/

/** Un bloc : un couple côte à côte, ou une personne seule. */
interface Block {
  /** Personnes du bloc, de gauche à droite. */
  members: string[];
  /** Blocs des enfants, dans l'ordre des naissances. */
  children: Block[];
  /** Largeur du bloc lui-même, sans sa descendance. */
  ownWidth: number;
  /** Largeur de toute la bande réservée : le bloc et tout ce qui pend dessous. */
  width: number;
}

export interface Placement {
  positions: Map<string, NodePosition>;
  /**
   * Les renvois à tracer : un par famille d'origine restée ailleurs.
   *
   * Une personne n'a qu'une place, mais peut avoir deux parents placés dans
   * deux familles différentes — c'est le cas dès que les deux conjoints d'un
   * couple ont eux-mêmes des parents connus. Le lien vers la seconde est
   * alors tracé à part, comme sur un arbre imprimé.
   */
  secondaryLinks: Array<{ parentId: string; childId: string }>;
  /**
   * Toutes les filiations concernées, `parent>enfant`.
   *
   * Distinct de `secondaryLinks`, qui n'en garde qu'une par famille pour le
   * tracé : celle-ci les liste toutes, afin que la descente normale les
   * ignore. Sans quoi la famille détachée dessinerait malgré tout son trait
   * plein jusqu'à l'enfant — le renvoi s'ajouterait au trait au lieu de le
   * remplacer, et on aurait les deux.
   */
  detachedFiliations: Set<string>;
}

/**
 * Regroupe les personnes en blocs.
 *
 * Un conjoint rejoint le bloc de son époux dès qu'il est encore libre : c'est
 * ce qui met les couples côte à côte. Qui est « l'époux » dépend de l'ordre de
 * parcours, stable d'un chargement à l'autre — l'arbre ne se réorganise donc
 * pas tout seul entre deux visites.
 */
function buildBlocks(graph: FamilyGraph): { blocks: Block[]; blockOf: Map<string, Block> } {
  const blockOf = new Map<string, Block>();
  const blocks: Block[] = [];

  for (const id of graph.order) {
    if (blockOf.has(id)) continue;
    const person = graph.people.get(id);
    if (!person) continue;

    const spouses: string[] = [];
    for (const link of person.spouseLinks) {
      if (blockOf.has(link.id) || !graph.people.has(link.id)) continue;
      spouses.push(link.id);
    }

    // Un seul conjoint : à droite. Plusieurs : ils encadrent la personne, pour
    // qu'aucun trait d'union n'ait à en enjamber un autre.
    const members =
      spouses.length === 0
        ? [id]
        : spouses.length === 1
          ? [id, spouses[0]]
          : [spouses[0], id, ...spouses.slice(1)];

    const block: Block = {
      members,
      children: [],
      ownWidth: members.length * CARD_WIDTH + (members.length - 1) * COUPLE_GAP,
      width: 0,
    };
    for (const memberId of members) blockOf.set(memberId, block);
    blocks.push(block);
  }

  return { blocks, blockOf };
}

/**
 * Relie les blocs entre eux : qui descend de qui.
 *
 * Un bloc n'a qu'un seul bloc parent — celui qui le porte dans la bande. Le
 * premier qui le réclame l'emporte, et les autres filiations deviennent des
 * liens secondaires : une personne ne peut occuper qu'une place, et prétendre
 * la placer sous deux familles à la fois est précisément ce qui étirait des
 * traits en travers de tout l'arbre.
 */
function linkBlocks(
  graph: FamilyGraph,
  blocks: Block[],
  blockOf: Map<string, Block>,
): { roots: Block[]; secondaryLinks: Placement['secondaryLinks']; detachedFiliations: Set<string> } {
  const claimed = new Set<Block>();
  const secondaryLinks: Placement['secondaryLinks'] = [];
  const detachedFiliations = new Set<string>();

  for (const block of blocks) {
    /*
     * Qui porte ce bloc ?
     *
     * Le premier membre — celui autour de qui le bloc s'est formé — passe en
     * premier : c'est sa lignée qui descend, son conjoint étant entré dans la
     * famille par le mariage. Laisser le hasard de l'ordre de parcours en
     * décider rattachait un couple tantôt d'un côté tantôt de l'autre, sans
     * qu'aucune raison ne le justifie.
     */
    let carrier: Block | undefined;
    for (const memberId of block.members) {
      const person = graph.people.get(memberId);
      if (!person) continue;
      for (const parentId of person.parents) {
        const parentBlock = blockOf.get(parentId);
        if (!parentBlock || parentBlock === block || claimed.has(block)) continue;
        carrier = parentBlock;
        parentBlock.children.push(block);
        claimed.add(block);
        break;
      }
      if (carrier) break;
    }

    /*
     * Ce que la bande ne peut pas porter.
     *
     * Un bloc n'a qu'une place ; les parents restés ailleurs se relient donc
     * par un renvoi. Un seul par famille d'origine, et non un par parent :
     * deux parents mariés vivent dans le même bloc, et tirer deux traits vers
     * le même endroit ne dirait rien de plus tout en doublant ce qui traverse
     * l'arbre.
     */
    const drawn = new Set<Block>();
    if (carrier) drawn.add(carrier);
    for (const memberId of block.members) {
      const person = graph.people.get(memberId);
      if (!person) continue;
      for (const parentId of person.parents) {
        const parentBlock = blockOf.get(parentId);
        if (!parentBlock || parentBlock === block || parentBlock === carrier) continue;
        // Toutes sont écartées de la descente normale…
        detachedFiliations.add(`${parentId}>${memberId}`);
        // …mais une seule est tracée par famille d'origine.
        if (drawn.has(parentBlock)) continue;
        drawn.add(parentBlock);
        secondaryLinks.push({ parentId, childId: memberId });
      }
    }
  }

  return { roots: blocks.filter((block) => !claimed.has(block)), secondaryLinks, detachedFiliations };
}

/** Largeur de la bande d'un bloc : la sienne, ou celle de sa descendance. */
function measure(block: Block): number {
  if (block.children.length === 0) {
    block.width = block.ownWidth;
    return block.width;
  }
  let total = 0;
  for (const child of block.children) {
    total += measure(child) + SIBLING_GAP;
  }
  total -= SIBLING_GAP;
  block.width = Math.max(block.ownWidth, total);
  return block.width;
}

/**
 * Pose le bloc et sa descendance dans la bande `[left, left + width]`.
 *
 * Le bloc se centre sur sa bande, la fratrie se répartit dessous en occupant
 * chacune la sienne. Rien n'est laissé à un ajustement ultérieur : les
 * coordonnées sorties d'ici sont définitives.
 */
function place(
  block: Block,
  left: number,
  graph: FamilyGraph,
  positions: Map<string, NodePosition>,
): void {
  let cursor = left + (block.width - block.ownWidth) / 2;
  for (const memberId of block.members) {
    const generation = graph.people.get(memberId)?.generation ?? 0;
    positions.set(memberId, {
      id: memberId,
      x: cursor,
      y: generation * ROW_HEIGHT,
      generation,
    });
    cursor += CARD_WIDTH + COUPLE_GAP;
  }

  // La descendance occupe toute la bande, centrée sous le bloc.
  let childrenWidth = 0;
  for (const child of block.children) childrenWidth += child.width + SIBLING_GAP;
  if (block.children.length > 0) childrenWidth -= SIBLING_GAP;

  let childCursor = left + (block.width - childrenWidth) / 2;
  for (const child of block.children) {
    place(child, childCursor, graph, positions);
    childCursor += child.width + SIBLING_GAP;
  }
}

/**
 * Place tout l'arbre.
 *
 * Les racines — les blocs que personne ne porte — sont posées les unes après
 * les autres, chacune dans sa bande. L'ordre est celui du graphe, stable d'une
 * visite à l'autre.
 */
export function computePlacement(graph: FamilyGraph): Placement {
  const { blocks, blockOf } = buildBlocks(graph);
  const { roots, secondaryLinks, detachedFiliations } = linkBlocks(graph, blocks, blockOf);

  const positions = new Map<string, NodePosition>();
  let cursor = 0;
  for (const root of roots) {
    measure(root);
    place(root, cursor, graph, positions);
    cursor += root.width + FAMILY_GAP;
  }

  // Filet de sécurité : personne ne doit rester sans coordonnées.
  for (const id of graph.order) {
    if (positions.has(id)) continue;
    const generation = graph.people.get(id)?.generation ?? 0;
    positions.set(id, { id, x: cursor, y: generation * ROW_HEIGHT, generation });
    cursor += CARD_WIDTH + SIBLING_GAP;
  }

  return { positions, secondaryLinks, detachedFiliations };
}
