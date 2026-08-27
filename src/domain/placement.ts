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
  above: Band[];
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

/** Une personne et ses conjoints encore libres, de gauche à droite. */
function withSpouses(graph: FamilyGraph, id: string, claimed: Set<string>): string[] {
  const members = [id];
  for (const link of graph.people.get(id)?.spouseLinks ?? []) {
    if (claimed.has(link.id) || !graph.people.has(link.id)) continue;
    claimed.add(link.id);
    members.push(link.id);
  }
  return members;
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
    spread(band.above.map((child) => child.width)),
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
  for (const memberId of members) {
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

    const parentBand = buildBand(graph, byBirth(graph, free), claimed);
    // La fratrie du membre : elle descend de ce couple-ci, donc c'est lui qui
    // la range — au même titre que ses propres neveux, dans la même bande.
    parentBand.below = freeChildren(graph, parentBand.members, claimed).map((childId) =>
      buildSub(graph, childId, claimed),
    );
    measureBand(parentBand);
    band.above.push(parentBand);
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
): void {
  let cursor = left;
  for (const id of ids) {
    const generation = generationOf(graph, id);
    positions.set(id, { id, x: cursor, y: generation * ROW_HEIGHT, generation });
    cursor += CARD_WIDTH + COUPLE_GAP;
  }
}

function placeSub(
  graph: FamilyGraph,
  sub: Sub,
  left: number,
  positions: Map<string, NodePosition>,
): void {
  placeMembers(graph, sub.members, left + (sub.width - sub.ownWidth) / 2, positions);
  const childrenWidth = spread(sub.children.map((child) => child.width));
  let cursor = left + (sub.width - childrenWidth) / 2;
  for (const child of sub.children) {
    placeSub(graph, child, cursor, positions);
    cursor += child.width + SIBLING_GAP;
  }
}

/**
 * Pose une bande et tout ce qu'elle porte.
 *
 * Le couple se centre sur sa bande ; ses bandes d'ascendance se répartissent
 * au-dessus, dans leur ordre ; ses autres enfants se répartissent en dessous.
 * Rien ne sort de la bande, donc rien ne peut aller croiser ce qui se passe
 * dans la bande voisine.
 */
function placeBand(
  graph: FamilyGraph,
  band: Band,
  left: number,
  positions: Map<string, NodePosition>,
): void {
  placeMembers(graph, band.members, left + (band.width - band.ownWidth) / 2, positions);

  const aboveWidth = spread(band.above.map((child) => child.width));
  let aboveCursor = left + (band.width - aboveWidth) / 2;
  for (const child of band.above) {
    placeBand(graph, child, aboveCursor, positions);
    aboveCursor += child.width + SIBLING_GAP;
  }

  const belowWidth = spread(band.below.map((sub) => sub.width));
  let belowCursor = left + (band.width - belowWidth) / 2;
  for (const sub of band.below) {
    placeSub(graph, sub, belowCursor, positions);
    belowCursor += sub.width + SIBLING_GAP;
  }
}

/**
 * Écarte ce qui se touche, rangée par rangée, sans jamais changer l'ordre.
 *
 * Les bandes sont disjointes, mais une descendance collatérale peut venir
 * buter contre l'échine deux générations plus bas. Pousser vers la droite ce
 * qui empiète suffit alors, et ne peut rien croiser puisque l'ordre est
 * conservé — c'est la seule retouche après coup, et elle ne peut que séparer.
 */
function separateRows(positions: Map<string, NodePosition>): void {
  const rows = new Map<number, NodePosition[]>();
  for (const position of positions.values()) {
    const row = rows.get(position.generation) ?? [];
    row.push(position);
    rows.set(position.generation, row);
  }

  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    for (let i = 1; i < row.length; i += 1) {
      const minimum = row[i - 1].x + CARD_WIDTH + COUPLE_GAP;
      if (row[i].x < minimum) row[i].x = minimum;
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

  placeBand(graph, root, 0, positions);
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

    placeBand(graph, band, cursor, positions);
    cursor += band.width + FAMILY_GAP;
  }

  separateRows(positions);
  return { positions };
}
