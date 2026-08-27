import type { FamilyGraph } from './graph';
import type { NodePosition } from './layout';
import { CARD_WIDTH, COUPLE_GAP, FAMILY_GAP, ROW_HEIGHT, SIBLING_GAP } from '@/view/metrics';

/*
 * ============================================================================
 *
 *  L'ARBRE D'ASCENDANCE
 *
 *  Un arbre centré sur quelqu'un — ici Antoine et Stella — se lit de bas en
 *  haut : le sujet en bas, ses parents au-dessus, leurs parents au-dessus
 *  d'eux, en éventail. Deux règles suffisent à le dessiner.
 *
 *    · L'ÉCHINE, ce sont les ancêtres directs. Chaque couple occupe une bande
 *      qui n'appartient qu'à lui ; les ancêtres du conjoint de gauche tiennent
 *      dans la moitié gauche de cette bande, ceux du conjoint de droite dans
 *      la moitié droite. Aucun trait ne peut passer de l'une à l'autre : c'est
 *      un arbre binaire, et un arbre binaire ne se croise pas.
 *
 *    · LES COLLATÉRAUX — frères, sœurs, oncles, cousins — se rangent sous
 *      leurs propres parents, dans la bande de ceux-ci, jamais dans celle de
 *      la génération d'en dessous. Une tante et le grand-père qu'elle a pour
 *      frère relèvent ainsi d'une seule et même bande, celle de leurs parents
 *      communs, qui les ordonne l'un par rapport à l'autre.
 *
 *  Cette seconde règle est ce qui distingue cette version de la précédente.
 *  Y rattacher les collatéraux à la bande de leur frère, une génération plus
 *  bas, les faisait ranger par une bande et leur descendance par une autre :
 *  deux mécanismes se disputaient la même rangée, et leurs traits se
 *  croisaient faute d'un ordre commun.
 *
 * ==========================================================================*/

/**
 * Un rameau : une personne, ses conjoints, et sa descendance.
 *
 * Il ne remonte jamais vers les ancêtres — c'est ce qui le distingue d'une
 * bande d'échine, et ce qui garantit qu'il tient dans une largeur bornée.
 */
interface Sub {
  members: string[];
  children: Sub[];
  ownWidth: number;
  width: number;
}

/**
 * Une bande de parents rattachée à l'un des membres du couple qu'elle
 * surplombe. `memberIndex` retient lequel, pour que le couple puisse se
 * poser près de sa propre ascendance plutôt qu'au centre de l'ensemble —
 * voir `placeBand`.
 */
interface AboveEntry {
  memberIndex: number;
  band: Band;
}

/**
 * Une bande d'échine : un couple d'ancêtres directs et tout ce qui en dépend.
 *
 * `above` porte les bandes des générations plus anciennes, dans l'ordre des
 * membres : celle des parents du membre de gauche d'abord. C'est cet ordre qui
 * interdit les croisements. `below` porte les autres enfants du couple — les
 * collatéraux — rangés par cette bande-ci puisque c'est d'elle qu'ils
 * descendent.
 */
interface Band {
  members: string[];
  above: AboveEntry[];
  below: Sub[];
  ownWidth: number;
  width: number;
}

export interface Placement {
  positions: Map<string, NodePosition>;
}

const widthOf = (count: number): number =>
  count * CARD_WIDTH + Math.max(0, count - 1) * COUPLE_GAP;

const spread = (widths: number[]): number =>
  widths.reduce((total, width) => total + width, 0) +
  Math.max(0, widths.length - 1) * SIBLING_GAP;

/** Ordonne une fratrie par année de naissance : l'ordre où on la récite. */
function byBirth(graph: FamilyGraph, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ya = graph.people.get(a)?.birthYear ?? Number.MAX_SAFE_INTEGER;
    const yb = graph.people.get(b)?.birthYear ?? Number.MAX_SAFE_INTEGER;
    return ya - yb || a.localeCompare(b);
  });
}

/**
 * Une personne et ses conjoints encore libres, de gauche à droite.
 *
 * Un seul conjoint se pose à droite. Plusieurs — un remariage, un veuvage —
 * encadrent la personne, qui reste au milieu : posée en tête, elle serait
 * voisine du premier conjoint seulement, et le trait vers le second devrait
 * enjamber le premier.
 */
function withSpouses(graph: FamilyGraph, id: string, claimed: Set<string>): string[] {
  const spouses: string[] = [];
  for (const link of graph.people.get(id)?.spouseLinks ?? []) {
    if (claimed.has(link.id) || !graph.people.has(link.id)) continue;
    claimed.add(link.id);
    spouses.push(link.id);
  }
  if (spouses.length === 0) return [id];
  if (spouses.length === 1) return [id, spouses[0]];
  return [spouses[0], id, ...spouses.slice(1)];
}

/** Les enfants encore libres d'un groupe de personnes, par ordre de naissance. */
function freeChildren(graph: FamilyGraph, members: string[], claimed: Set<string>): string[] {
  const found: string[] = [];
  for (const memberId of members) {
    for (const childId of graph.people.get(memberId)?.children ?? []) {
      if (claimed.has(childId) || found.includes(childId)) continue;
      found.push(childId);
    }
  }
  return byBirth(graph, found);
}

/** Construit un rameau : la personne, ses conjoints, sa descendance. */
function buildSub(graph: FamilyGraph, id: string, claimed: Set<string>): Sub {
  claimed.add(id);
  const members = withSpouses(graph, id, claimed);
  const children = freeChildren(graph, members, claimed).map((childId) =>
    buildSub(graph, childId, claimed),
  );
  const ownWidth = widthOf(members.length);
  return {
    members,
    children,
    ownWidth,
    width: Math.max(ownWidth, spread(children.map((child) => child.width))),
  };
}

function measureBand(band: Band): void {
  band.width = Math.max(
    band.ownWidth,
    spread(band.above.map((entry) => entry.band.width)),
    spread(band.below.map((sub) => sub.width)),
  );
}

/**
 * Construit une bande d'échine et, de proche en proche, tout ce qui la
 * surplombe.
 *
 * Chaque couple de parents distinct donne une bande, dans l'ordre des membres,
 * ce qui aligne la génération du dessus sur celle du dessous. Les autres
 * enfants de ce couple — la fratrie du membre — sont rangés par cette
 * bande-là, sous elle, et non par la bande d'en dessous.
 */
function buildBand(graph: FamilyGraph, members: string[], claimed: Set<string>): Band {
  const band: Band = {
    members,
    above: [],
    below: [],
    ownWidth: widthOf(members.length),
    width: 0,
  };

  const seen = new Set<string>();
  for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
    const memberId = members[memberIndex];
    const parents = (graph.people.get(memberId)?.parents ?? []).filter((id) =>
      graph.people.has(id),
    );
    if (parents.length === 0) continue;
    const key = [...parents].sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key);

    const free = parents.filter((id) => !claimed.has(id));
    if (free.length === 0) continue;
    for (const id of free) claimed.add(id);

    /*
     * Les autres conjoints des parents rejoignent la rangée.
     *
     * Un ancêtre remarié n'est le parent de la lignée qu'avec l'un de ses
     * conjoints ; l'autre n'appartient donc pas au couple, mais doit rester à
     * côté de lui. Laissé de côté, il se retrouvait cinq cents pixels plus
     * loin, et le trait de son mariage traversait la moitié de la rangée. On
     * le pose donc de l'autre bord, l'ancêtre restant au milieu de ses deux
     * unions.
     */
    const ordered = byBirth(graph, free);
    const otherSpouses = (id: string): string[] => {
      const found: string[] = [];
      for (const link of graph.people.get(id)?.spouseLinks ?? []) {
        if (claimed.has(link.id) || !graph.people.has(link.id)) continue;
        claimed.add(link.id);
        found.push(link.id);
      }
      return found;
    };
    const bandMembers = [
      ...otherSpouses(ordered[0]),
      ...ordered,
      ...(ordered.length > 1 ? otherSpouses(ordered[ordered.length - 1]) : []),
    ];

    const parentBand = buildBand(graph, bandMembers, claimed);
    // La fratrie du membre : elle descend de ce couple-ci, donc c'est lui qui
    // la range — au même titre que ses propres neveux, dans la même bande.
    parentBand.below = freeChildren(graph, parentBand.members, claimed).map((childId) =>
      buildSub(graph, childId, claimed),
    );
    measureBand(parentBand);
    band.above.push({ memberIndex, band: parentBand });
  }

  measureBand(band);
  return band;
}

const generationOf = (graph: FamilyGraph, id: string): number =>
  graph.people.get(id)?.generation ?? 0;

function placeMembers(
  graph: FamilyGraph,
  ids: string[],
  left: number,
  positions: Map<string, NodePosition>,
  groups: string[][],
): void {
  let cursor = left;
  for (const id of ids) {
    const generation = generationOf(graph, id);
    positions.set(id, { id, x: cursor, y: generation * ROW_HEIGHT, generation });
    cursor += CARD_WIDTH + COUPLE_GAP;
  }
  // Un couple posé ensemble ne doit plus jamais être séparé — voir `separateRows`.
  groups.push(ids);
}

function placeSub(
  graph: FamilyGraph,
  sub: Sub,
  left: number,
  positions: Map<string, NodePosition>,
  groups: string[][],
): void {
  placeMembers(graph, sub.members, left + (sub.width - sub.ownWidth) / 2, positions, groups);
  const childrenWidth = spread(sub.children.map((child) => child.width));
  let cursor = left + (sub.width - childrenWidth) / 2;
  for (const child of sub.children) {
    placeSub(graph, child, cursor, positions, groups);
    cursor += child.width + SIBLING_GAP;
  }
}

/**
 * Pose une bande et tout ce qu'elle porte.
 *
 * Chaque membre du couple se pose au plus près du milieu de ses propres
 * parents — pas au milieu de la bande entière, et pas non plus au milieu de
 * l'ensemble des deux ascendances mises bout à bout.
 *
 * Centrer sur la bande entière la faisait dériver vers le côté où pendait le
 * plus de monde : une ascendance profonde d'un seul côté, ou des collatéraux
 * nombreux en dessous, tiraient le couple loin de ses parents à lui.
 * Centrer sur la largeur totale de `above` (les deux ascendances mises bout
 * à bout) restait faux dès que l'une était bien plus large que l'autre :
 * Manuel Albertini, dont les parents tenaient dans 434px, se retrouvait
 * entraîné à 730px d'eux parce que sa femme comptait, de son côté, 1170px de
 * cousinage — le milieu du total ne ressemble au milieu d'aucun des deux.
 *
 * On pose donc chaque membre à l'endroit qui l'approcherait le plus de SES
 * parents si lui seul comptait, puis on fait la moyenne de ces endroits : la
 * position qui minimise l'écart total est celle où chacun s'écarte autant
 * que l'autre de sa propre ascendance — le meilleur compromis qu'un couple
 * soudé puisse tenir entre deux ascendances de tailles différentes. Un
 * membre sans parent connu ne contraint rien ; il suit simplement le reste
 * du couple. Personne n'ayant de parent connu, faute de mieux, le couple
 * garde le milieu de la bande entière.
 */
function placeBand(
  graph: FamilyGraph,
  band: Band,
  left: number,
  positions: Map<string, NodePosition>,
  groups: string[][],
): void {
  const aboveWidth = spread(band.above.map((entry) => entry.band.width));
  const belowWidth = spread(band.below.map((sub) => sub.width));
  const aboveLeft = left + (band.width - aboveWidth) / 2;

  const aboveLefts: number[] = [];
  {
    let cursor = aboveLeft;
    for (const entry of band.above) {
      aboveLefts.push(cursor);
      cursor += entry.band.width + SIBLING_GAP;
    }
  }

  // Le centre qu'aurait le membre à cet index si on le posait juste sous sa
  // propre ascendance, rapporté à `anchoredLeft` (le début du couple).
  const memberCenter = (index: number): number =>
    index * (CARD_WIDTH + COUPLE_GAP) + CARD_WIDTH / 2;

  const anchoredLeft =
    band.above.length > 0
      ? band.above.reduce((sum, entry, i) => {
          const aboveCenter = aboveLefts[i] + entry.band.width / 2;
          return sum + (aboveCenter - memberCenter(entry.memberIndex));
        }, 0) / band.above.length
      : left + (band.width - band.ownWidth) / 2;

  placeMembers(graph, band.members, anchoredLeft, positions, groups);

  band.above.forEach((entry, i) => {
    placeBand(graph, entry.band, aboveLefts[i], positions, groups);
  });

  let belowCursor = anchoredLeft + (band.ownWidth - belowWidth) / 2;
  for (const sub of band.below) {
    placeSub(graph, sub, belowCursor, positions, groups);
    belowCursor += sub.width + SIBLING_GAP;
  }
}

/**
 * Écarte ce qui se touche, rangée par rangée, sans jamais séparer un couple.
 *
 * Les bandes sont disjointes, mais une descendance collatérale peut venir
 * buter contre l'échine deux générations plus bas. Pousser vers la droite ce
 * qui empiète suffit alors, et ne peut rien croiser puisque l'ordre est
 * conservé.
 *
 * Le déplacement porte sur des groupes entiers, jamais sur des cartes isolées.
 * Traiter les cartes une à une laissait un tiers s'intercaler entre deux
 * époux dont les bandes se recouvraient : Hugette Cheneaud et François Mattei
 * se retrouvaient séparés par Marie-Catherine, et le trait de leur mariage
 * enjambait quelqu'un qui n'avait rien à y faire. Un couple posé ensemble
 * reste ensemble.
 */
function separateRows(positions: Map<string, NodePosition>, groups: string[][]): void {
  const rows = new Map<number, string[][]>();
  for (const members of groups) {
    const first = positions.get(members[0]);
    if (!first) continue;
    const row = rows.get(first.generation) ?? [];
    row.push(members);
    rows.set(first.generation, row);
  }

  const leftOf = (members: string[]): number => positions.get(members[0])?.x ?? 0;

  for (const row of rows.values()) {
    row.sort((a, b) => leftOf(a) - leftOf(b) || a[0].localeCompare(b[0]));

    let previous: number | undefined;
    for (const members of row) {
      const width = members.length * CARD_WIDTH + (members.length - 1) * COUPLE_GAP;
      const minimum = previous === undefined ? leftOf(members) : previous + SIBLING_GAP;
      const x = Math.max(leftOf(members), minimum);

      let cursor = x;
      for (const id of members) {
        const position = positions.get(id);
        if (!position) continue;
        position.x = cursor;
        cursor += CARD_WIDTH + COUPLE_GAP;
      }
      previous = x + width;
    }
  }
}

/**
 * Place tout l'arbre, à partir du sujet.
 *
 * Le sujet et sa fratrie forment la rangée du bas ; leur ascendance s'élève
 * au-dessus. Ce que ce parcours n'atteint pas — une branche importée sans
 * lien, une famille isolée — est posé à la suite, avec sa propre échine.
 */
export function computePlacement(graph: FamilyGraph): Placement {
  const positions = new Map<string, NodePosition>();
  const claimed = new Set<string>();

  const rootId = graph.people.has(graph.rootId) ? graph.rootId : graph.order[0];
  if (!rootId) return { positions };

  const subjectIds = byBirth(graph, [rootId, ...(graph.people.get(rootId)?.siblings ?? [])]);
  const subjectRow: string[] = [];
  for (const id of subjectIds) {
    if (claimed.has(id)) continue;
    claimed.add(id);
    subjectRow.push(...withSpouses(graph, id, claimed));
  }

  const root = buildBand(graph, subjectRow, claimed);
  root.below = freeChildren(graph, subjectRow, claimed).map((childId) =>
    buildSub(graph, childId, claimed),
  );
  measureBand(root);

  const groups: string[][] = [];
  placeBand(graph, root, 0, positions, groups);
  let cursor = root.width + FAMILY_GAP;

  /*
   * Ce qui n'est relié à rien.
   *
   * Une branche dont le lien de filiation manque forme sa propre famille : on
   * lui donne sa propre échine et on la pose à la suite. Le bandeau
   * d'anomalies signale par ailleurs qu'elle est détachée.
   */
  for (const id of graph.order) {
    if (claimed.has(id)) continue;
    claimed.add(id);
    const band = buildBand(graph, withSpouses(graph, id, claimed), claimed);
    band.below = freeChildren(graph, band.members, claimed).map((childId) =>
      buildSub(graph, childId, claimed),
    );
    measureBand(band);

    placeBand(graph, band, cursor, positions, groups);
    cursor += band.width + FAMILY_GAP;
  }

  separateRows(positions, groups);
  return { positions };
}
