import type { FamilyGraph } from './graph';
import type { NodePosition } from './layout';
import { CARD_WIDTH, COUPLE_GAP, FAMILY_GAP, ROW_HEIGHT, SIBLING_GAP } from '@/view/metrics';

/*
 * ============================================================================
 *
 *  L'ARBRE D'ASCENDANCE D'UNE PERSONNE
 *
 *  On affiche tout ce qui remonte depuis la personne regardée : ses deux
 *  parents, leurs parents, et ainsi de suite jusqu'aux plus anciens connus —
 *  avec, à chaque étage, les frères et sœurs de chaque ancêtre (les oncles,
 *  grands-oncles, grands-tantes). Plus, en bas, sa propre fratrie, son
 *  conjoint et ses enfants. Cliquer sur quelqu'un ouvre SON ascendance.
 *
 *  Ce que cette vue a de particulier, et qui règle enfin le problème : une
 *  ascendance est un ARBRE, pas un graphe. Chacun a deux parents, un point
 *  c'est tout. Il n'existe aucun chemin par lequel la branche paternelle
 *  pourrait rejoindre la branche maternelle, donc aucun trait ne peut en
 *  croiser un autre. C'est une propriété de la structure, pas le résultat
 *  d'une optimisation.
 *
 *  C'est là que toutes les versions précédentes se trompaient : elles
 *  plaçaient tout le monde d'un coup. Or l'arbre complet, lui, EST un graphe
 *  — une personne mariée appartient à la fois à la famille de ses parents et
 *  à celle de son conjoint, et les deux tirent sur elle. On a mesuré, sur les
 *  vraies données, qu'aucun arbitrage n'en sort indemne : les bandes
 *  laissaient 5 croisements, Sugiyama 10 et des fratries éparpillées sur
 *  treize cents pixels. En ne montrant qu'une ascendance à la fois, la
 *  question ne se pose plus.
 *
 *      · · · · ·   ( arrière-grands-parents )
 *        ( · · )        ( · · )   grands-parents et leurs frères et sœurs
 *            ( · · )              parents et leurs frères et sœurs
 *          · [ · ] ·              la personne, sa fratrie, son conjoint
 *             · ·                 ses enfants
 *
 *  Chaque couple d'ancêtres est posé au-dessus de sa propre fratrie : le
 *  membre de gauche a ses frères et sœurs à sa gauche, celui de droite à sa
 *  droite. Les deux conjoints restent donc toujours accolés, et chaque
 *  branche garde sa moitié du dessin.
 *
 * ==========================================================================*/

export interface Placement {
  positions: Map<string, NodePosition>;
}

/** Au-delà, on ne remonte plus : une donnée en boucle ne doit pas tout figer. */
const MAX_GENERATIONS = 24;

const SIBLING_STEP = CARD_WIDTH + SIBLING_GAP;
const COUPLE_STEP = CARD_WIDTH + COUPLE_GAP;

/**
 * Un couple d'ancêtres, ses frères et sœurs, et tout ce qui le surplombe.
 *
 * `left` et `right` sont les deux conjoints, toujours accolés. Les frères et
 * sœurs de `left` se rangent à SA gauche, ceux de `right` à SA droite : c'est
 * ce qui laisse le milieu libre pour le couple et empêche qu'un trait
 * d'alliance enjambe qui que ce soit.
 */
interface Ancestry {
  left?: string;
  right?: string;
  leftSiblings: string[];
  rightSiblings: string[];
  leftParents?: Ancestry;
  rightParents?: Ancestry;
  generation: number;
  /** Largeur de la seule rangée de ce couple. */
  ownWidth: number;
  /**
   * Étendue de tout ce que ce couple porte, mesurée depuis le bord gauche de
   * sa propre rangée. `lo` est négatif dès que l'ascendance déborde à gauche.
   */
  lo: number;
  hi: number;
  /**
   * Où poser le MILIEU de la rangée de chaque couple de parents, toujours
   * depuis le bord gauche de cette rangée-ci. C'est ce qui met le trait de
   * filiation à l'aplomb de la fratrie qu'il dessert.
   */
  shiftLeft: number;
  shiftRight: number;
}

/** Ordonne une fratrie par année de naissance : l'ordre où on la récite. */
function byBirth(graph: FamilyGraph, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ya = graph.people.get(a)?.birthYear ?? Number.MAX_SAFE_INTEGER;
    const yb = graph.people.get(b)?.birthYear ?? Number.MAX_SAFE_INTEGER;
    return ya - yb || a.localeCompare(b);
  });
}

const parentsOf = (graph: FamilyGraph, id: string): string[] =>
  (graph.people.get(id)?.parents ?? []).filter((parentId) => graph.people.has(parentId));

const siblingsOf = (graph: FamilyGraph, id: string): string[] =>
  (graph.people.get(id)?.siblings ?? []).filter((otherId) => graph.people.has(otherId));

/**
 * Construit l'ascendance au-dessus d'une personne.
 *
 * `taken` empêche qu'une même personne soit posée deux fois : un mariage entre
 * cousins fait remonter deux fois au même ancêtre, et la carte se
 * dédoublerait. La première branche qui l'atteint le garde ; l'autre s'arrête
 * là, et le lien manquant reste visible dans la fiche de la personne.
 */
function buildAncestry(
  graph: FamilyGraph,
  childId: string,
  generation: number,
  taken: Set<string>,
  depth: number,
): Ancestry | undefined {
  if (depth > MAX_GENERATIONS) return undefined;

  const parents = byBirth(
    graph,
    parentsOf(graph, childId).filter((id) => !taken.has(id)),
  );
  if (parents.length === 0) return undefined;
  for (const id of parents) taken.add(id);

  const left = parents[0];
  const right = parents.length > 1 ? parents[1] : undefined;

  const claimSiblings = (id: string | undefined): string[] => {
    if (!id) return [];
    const found = byBirth(
      graph,
      siblingsOf(graph, id).filter((otherId) => !taken.has(otherId)),
    );
    for (const otherId of found) taken.add(otherId);
    return found;
  };

  // Les frères et sœurs du membre de gauche se lisent de gauche à droite en
  // remontant vers lui : l'aîné le plus à l'extérieur, comme sur un acte.
  const leftSiblings = claimSiblings(left);
  const rightSiblings = claimSiblings(right);

  const node: Ancestry = {
    left,
    right,
    leftSiblings,
    rightSiblings,
    leftParents: buildAncestry(graph, left, generation - 1, taken, depth + 1),
    rightParents: right
      ? buildAncestry(graph, right, generation - 1, taken, depth + 1)
      : undefined,
    generation,
    ownWidth: 0,
    lo: 0,
    hi: 0,
    shiftLeft: 0,
    shiftRight: 0,
  };

  measure(node);
  return node;
}

/** Largeur d'une suite de cartes séparées par `gap`. */
const run = (count: number, gap: number): number =>
  count <= 0 ? 0 : count * CARD_WIDTH + (count - 1) * gap;

/**
 * Mesure ce que ce couple occupe, et décide où poser ses deux ascendances.
 *
 * Chaque couple de parents se pose à l'aplomb de la fratrie qu'il a eue : le
 * couple paternel au milieu de [frères et sœurs du père + le père], le couple
 * maternel au milieu de [la mère + ses frères et sœurs]. C'est ce qui rend le
 * trait de filiation vertical.
 *
 * Les centrer plutôt au milieu de la bande, comme on l'a d'abord fait,
 * mettait certains traits à quatre cent cinquante pixels de la fratrie qu'ils
 * desservaient : la bande est large de toute l'ascendance, la fratrie n'en
 * occupe qu'un coin.
 *
 * Si les deux ascendances se recouvrent, on les écarte à parts égales — le
 * dessin penche alors symétriquement, ce qui se lit comme un choix plutôt que
 * comme une erreur. Leur ordre, lui, ne change jamais : la branche paternelle
 * reste à gauche de la maternelle, et aucun trait ne peut donc en croiser un
 * autre.
 */
function measure(node: Ancestry): void {
  const leftCount = node.leftSiblings.length + (node.left ? 1 : 0);
  const rightCount = node.rightSiblings.length + (node.right ? 1 : 0);

  const leftRun = run(leftCount, SIBLING_GAP);
  const rightRun = run(rightCount, SIBLING_GAP);

  // Les deux moitiés se touchent par le couple : COUPLE_GAP entre les deux
  // conjoints, SIBLING_GAP partout ailleurs.
  node.ownWidth =
    leftCount > 0 && rightCount > 0 ? leftRun + COUPLE_GAP + rightRun : leftRun + rightRun;

  // Le milieu de chaque fratrie, depuis le bord gauche de la rangée.
  const leftMiddle = leftRun / 2;
  const rightMiddle = (leftCount > 0 ? leftRun + COUPLE_GAP : 0) + rightRun / 2;

  // L'étendue d'une ascendance, ramenée au milieu de SA rangée.
  const spanOf = (child: Ancestry | undefined): { lo: number; hi: number } | undefined =>
    child ? { lo: child.lo - child.ownWidth / 2, hi: child.hi - child.ownWidth / 2 } : undefined;

  const ls = spanOf(node.leftParents);
  const rs = spanOf(node.rightParents);

  let shiftLeft = leftMiddle;
  let shiftRight = rightMiddle;

  if (ls && rs) {
    const overlap = shiftLeft + ls.hi + FAMILY_GAP - (shiftRight + rs.lo);
    if (overlap > 0) {
      shiftLeft -= overlap / 2;
      shiftRight += overlap / 2;
    }
  }

  node.shiftLeft = shiftLeft;
  node.shiftRight = shiftRight;

  node.lo = Math.min(0, ls ? shiftLeft + ls.lo : 0, rs ? shiftRight + rs.lo : 0);
  node.hi = Math.max(node.ownWidth, ls ? shiftLeft + ls.hi : 0, rs ? shiftRight + rs.hi : 0);
}

/** Pose une suite de cartes à partir de `left`, et rend l'abscisse suivante. */
function lay(
  ids: Array<string | undefined>,
  left: number,
  generation: number,
  steps: number[],
  positions: Map<string, NodePosition>,
): number {
  let cursor = left;
  ids.forEach((id, index) => {
    if (id) positions.set(id, { id, x: cursor, y: generation * ROW_HEIGHT, generation });
    cursor += steps[index];
  });
  return cursor;
}

/**
 * Pose un couple d'ancêtres et toute son ascendance, `rowLeft` étant le bord
 * gauche de sa propre rangée.
 *
 * `measure` a déjà décidé où va le milieu de chaque rangée de parents : il ne
 * reste qu'à traduire ce milieu en bord gauche.
 */
function placeAncestry(
  node: Ancestry,
  rowLeft: number,
  positions: Map<string, NodePosition>,
): void {
  const row = [...node.leftSiblings, node.left, node.right, ...node.rightSiblings].filter(
    (id): id is string => Boolean(id),
  );

  // Le pas après chaque carte : COUPLE_GAP entre les deux conjoints seulement.
  const coupleAt = node.left && node.right ? node.leftSiblings.length : -1;
  const steps = row.map((_, index) => (index === coupleAt ? COUPLE_STEP : SIBLING_STEP));

  lay(row, rowLeft, node.generation, steps, positions);

  if (node.leftParents) {
    placeAncestry(
      node.leftParents,
      rowLeft + node.shiftLeft - node.leftParents.ownWidth / 2,
      positions,
    );
  }
  if (node.rightParents) {
    placeAncestry(
      node.rightParents,
      rowLeft + node.shiftRight - node.rightParents.ownWidth / 2,
      positions,
    );
  }
}

/**
 * Place l'ascendance de `focusId`, sa fratrie, son conjoint et ses enfants.
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
  const taken = new Set<string>([focus]);

  /*
   * ── L'ascendance ────────────────────────────────────────────────────────
   *
   * Elle se construit et se mesure d'abord : c'est elle qui donne sa largeur
   * au dessin, et c'est sous elle que le reste vient se centrer.
   */
  const ancestry = buildAncestry(graph, focus, generation - 1, taken, 1);
  // `lo` est négatif dès que l'ascendance déborde à gauche de la rangée des
  // parents : on décale d'autant pour que rien ne sorte du cadre.
  if (ancestry) placeAncestry(ancestry, -ancestry.lo, positions);

  /*
   * ── La rangée de la personne ────────────────────────────────────────────
   *
   * Sa fratrie dans l'ordre des naissances, elle-même à sa place dedans. Le
   * groupe se centre sous le couple de ses parents, car c'est de lui qu'il
   * descend — le conjoint, lui, vient s'ajouter à la suite sans compter dans
   * ce centrage : il n'est pas leur enfant.
   */
  const sibship = byBirth(graph, [focus, ...siblingsOf(graph, focus)]).filter(
    (id) => id === focus || !taken.has(id),
  );
  for (const id of sibship) taken.add(id);

  const spouses: string[] = [];
  for (const link of person.spouseLinks) {
    if (taken.has(link.id) || !graph.people.has(link.id)) continue;
    taken.add(link.id);
    spouses.push(link.id);
  }

  const sibshipWidth = run(sibship.length, SIBLING_GAP);
  const parentsMiddle =
    ancestry && ancestry.left
      ? (() => {
          const a = positions.get(ancestry.left)!;
          const b = ancestry.right ? positions.get(ancestry.right) : undefined;
          return b ? (a.x + b.x + CARD_WIDTH) / 2 : a.x + CARD_WIDTH / 2;
        })()
      : CARD_WIDTH / 2;

  const sibshipLeft = parentsMiddle - sibshipWidth / 2;
  const steps = sibship.map((_, index) =>
    index === sibship.indexOf(focus) ? COUPLE_STEP : SIBLING_STEP,
  );
  lay(sibship, sibshipLeft, generation, steps, positions);

  // Le conjoint se pose juste après la personne, en décalant les cadets.
  if (spouses.length > 0) {
    const focusIndex = sibship.indexOf(focus);
    const younger = sibship.slice(focusIndex + 1);
    const shift = spouses.length * COUPLE_STEP;
    for (const id of younger) {
      const node = positions.get(id);
      if (node) node.x += shift;
    }
    const focusNode = positions.get(focus)!;
    lay(
      spouses,
      focusNode.x + COUPLE_STEP,
      generation,
      spouses.map(() => COUPLE_STEP),
      positions,
    );
  }

  /*
   * ── Les enfants ─────────────────────────────────────────────────────────
   *
   * Centrés sous le couple : le trait de descendance part du milieu du trait
   * d'alliance, pas de la seule personne regardée.
   */
  const children = byBirth(
    graph,
    (person.children ?? []).filter((id) => graph.people.has(id) && !taken.has(id)),
  );
  if (children.length > 0) {
    for (const id of children) taken.add(id);
    const focusNode = positions.get(focus)!;
    const last = spouses.length > 0 ? positions.get(spouses[spouses.length - 1])! : focusNode;
    const middle = (focusNode.x + last.x + CARD_WIDTH) / 2;
    lay(
      children,
      middle - run(children.length, SIBLING_GAP) / 2,
      generation + 1,
      children.map(() => SIBLING_STEP),
      positions,
    );
  }

  // Tout ramener dans le quadrant positif : le cadre part de l'origine.
  let minX = Number.POSITIVE_INFINITY;
  for (const node of positions.values()) minX = Math.min(minX, node.x);
  if (Number.isFinite(minX) && minX !== 0) {
    for (const node of positions.values()) node.x -= minX;
  }

  return { positions };
}
