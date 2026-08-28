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
  limit: number,
  withCollaterals: boolean,
): Ancestry | undefined {
  if (depth > limit) return undefined;

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
  // En vue « famille », on ne montre que les parents eux-mêmes : leurs frères
  // et sœurs appartiennent à leur famille à eux, pas à celle qu'on regarde.
  const leftSiblings = withCollaterals ? claimSiblings(left) : [];
  const rightSiblings = withCollaterals ? claimSiblings(right) : [];

  const node: Ancestry = {
    left,
    right,
    leftSiblings,
    rightSiblings,
    leftParents: buildAncestry(graph, left, generation - 1, taken, depth + 1, limit, withCollaterals),
    rightParents: right
      ? buildAncestry(graph, right, generation - 1, taken, depth + 1, limit, withCollaterals)
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
 *
 * `expanded` ajoute, pour les personnes qu'il nomme, leur conjoint et leurs
 * enfants — ce que l'ascendance seule ne montre pas.
 */
export interface PlacementOptions {
  /**
   * Vue « famille » : on s'arrête aux parents, sans leurs frères et sœurs.
   *
   * C'est le mode qu'ouvre un clic sur quelqu'un dont l'ascendance cache une
   * union — on veut voir SA famille, pas repartir dans une lignée entière.
   */
  familyOnly?: boolean;
}

export function computePlacement(
  graph: FamilyGraph,
  focusId?: string,
  options?: PlacementOptions,
): Placement {
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
  const familyOnly = options?.familyOnly ?? false;
  const ancestry = buildAncestry(
    graph,
    focus,
    generation - 1,
    taken,
    1,
    familyOnly ? 1 : MAX_GENERATIONS,
    !familyOnly,
  );
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

  /*
   * Les conjoints se posent contre la personne, en décalant la fratrie.
   *
   * Un seul conjoint va à droite. Plusieurs — un remariage, un veuvage —
   * encadrent la personne, qui reste au milieu : tous posés du même côté, le
   * trait vers le second devait enjamber le premier, et les deux cartes se
   * retrouvaient à cent soixante-seize pixels l'une de l'autre.
   */
  if (spouses.length > 0) {
    const focusIndex = sibship.indexOf(focus);
    const before = spouses.length > 1 ? 1 : 0;
    const leftRoom = before * COUPLE_STEP;
    const rightRoom = (spouses.length - before) * COUPLE_STEP;

    sibship.forEach((id, index) => {
      const node = positions.get(id);
      if (!node || index < focusIndex) return;
      // Le sujet ne glisse que de la place ouverte à sa gauche ; ses cadets,
      // de celle ouverte des deux côtés.
      node.x += index === focusIndex ? leftRoom : leftRoom + rightRoom;
    });

    const focusNode = positions.get(focus)!;
    if (before > 0) {
      positions.set(spouses[0], {
        id: spouses[0],
        x: focusNode.x - COUPLE_STEP,
        y: focusNode.y,
        generation,
      });
    }
    spouses.slice(before).forEach((id, index) => {
      positions.set(id, {
        id,
        x: focusNode.x + (index + 1) * COUPLE_STEP,
        y: focusNode.y,
        generation,
      });
    });
  }

  /*
   * ── Les enfants ─────────────────────────────────────────────────────────
   *
   * Groupés par union, chaque groupe sous SON couple.
   *
   * Tous centrés au même endroit — ce qu'on faisait d'abord —, les enfants
   * d'un premier lit et ceux d'un second partaient du même point : leurs deux
   * traits se croisaient forcément. Chaque fratrie se pose donc sous le couple
   * dont elle est issue, et les groupes se suivent dans l'ordre des conjoints,
   * ce qui interdit tout croisement.
   */
  const children = byBirth(
    graph,
    (person.children ?? []).filter((id) => graph.people.has(id) && !taken.has(id)),
  );
  if (children.length > 0) {
    for (const id of children) taken.add(id);

    const focusX = positions.get(focus)!.x;
    const groups: Array<{ anchor: number; kids: string[] }> = [];
    const placed = new Set<string>();

    for (const spouseId of spouses) {
      const kids = children.filter(
        (kid) => !placed.has(kid) && (graph.people.get(kid)?.parents ?? []).includes(spouseId),
      );
      if (kids.length === 0) continue;
      for (const kid of kids) placed.add(kid);
      const spouseX = positions.get(spouseId)!.x;
      groups.push({ anchor: (focusX + spouseX + CARD_WIDTH) / 2, kids });
    }

    // Les enfants dont l'autre parent n'est pas ici pendent du sujet seul.
    const alone = children.filter((kid) => !placed.has(kid));
    if (alone.length > 0) groups.push({ anchor: focusX + CARD_WIDTH / 2, kids: alone });

    groups.sort((a, b) => a.anchor - b.anchor);

    let edge = Number.NEGATIVE_INFINITY;
    for (const group of groups) {
      const width = run(group.kids.length, SIBLING_GAP);
      const left = Math.max(group.anchor - width / 2, edge);
      lay(group.kids, left, generation + 1, group.kids.map(() => SIBLING_STEP), positions);
      edge = left + width + SIBLING_GAP;
    }
  }

  /*
   * ── Les marges ──────────────────────────────────────────────────────────
   *
   * Un collatéral en bord de dessin — comme Florence Mailllet, seule à gauche
   * de sa rangée — a souvent un conjoint et des enfants qu'on ne montre pas :
   * c'est ce que signale son point. S'il y a de la place, on les montre
   * directement plutôt que d'obliger à cliquer : rien ne les gênerait, la
   * marge est vide par construction.
   *
   * On ne déplace jamais une carte déjà posée — seulement en ajouter dans un
   * espace qui n'appartenait à personne.
   */
  expandEdges(graph, positions, taken);

  // Tout ramener dans le quadrant positif : le cadre part de l'origine.
  let minX = Number.POSITIVE_INFINITY;
  for (const node of positions.values()) minX = Math.min(minX, node.x);
  if (Number.isFinite(minX) && minX !== 0) {
    for (const node of positions.values()) node.x -= minX;
  }

  return { positions };
}

/**
 * Complète, dans tout espace libre d'une rangée, ce qu'on ne montre pas.
 *
 * D'abord limitée aux deux bords du dessin entier — les seuls dont on soit
 * sûr, sans plus regarder, que rien n'y existe déjà —, elle ne voyait pas
 * Paul Albertini : sa bande, plus étroite que sa voisine, laissait un blanc
 * en plein milieu de la rangée, pas à ses bords à elle. Or un blanc entre
 * deux cartes déjà posées est tout aussi sûr qu'une marge extérieure : rien
 * de ce calcul-ci n'a pu s'y poser, sans quoi il n'y aurait pas de blanc.
 *
 * On regarde donc CHAQUE creux d'une rangée — y compris les deux marges
 * extérieures, qui n'ont simplement pas de voisin d'un côté — et on y glisse
 * le conjoint cache du bord le plus proche, puis ses enfants si la place le
 * permet.
 */
function expandEdges(
  graph: FamilyGraph,
  positions: Map<string, NodePosition>,
  taken: Set<string>,
): void {
  const rows = new Map<number, NodePosition[]>();
  for (const node of positions.values()) {
    const row = rows.get(node.generation) ?? [];
    row.push(node);
    rows.set(node.generation, row);
  }

  const hiddenSpouse = (id: string): string | undefined =>
    graph.people
      .get(id)
      ?.spouseLinks.map((link) => link.id)
      .find((spouseId) => graph.people.has(spouseId) && !taken.has(spouseId));

  const hiddenChildren = (id: string): string[] =>
    byBirth(
      graph,
      (graph.people.get(id)?.children ?? []).filter(
        (kidId) => graph.people.has(kidId) && !taken.has(kidId),
      ),
    );

  /**
   * Une carte, déjà posée à cette génération, chevauche-t-elle `[lo, hi]` ?
   *
   * Comparait d'abord `[lo, hi]` au seul rectangle englobant du minimum au
   * maximum de toute la rangée — traitant donc tout le VIDE entre les cartes
   * comme s'il était plein. Sur une rangée large de tout le dessin (le cas
   * courant à partir de quelques générations), pratiquement toute case s'y
   * trouvait comprise, et plus aucun enfant ne pouvait jamais être révélé :
   * Paul Albertini restait cacher quel que soit l'espace réellement libre à
   * côté de lui. On regarde maintenant chaque carte une à une.
   */
  const rangeFree = (generation: number, lo: number, hi: number): boolean => {
    const row = rows.get(generation);
    if (!row) return true;
    return row.every((n) => n.x + CARD_WIDTH <= lo || n.x >= hi);
  };

  for (const [generation, row] of rows) {
    row.sort((a, b) => a.x - b.x);

    /** Pose des enfants sous `[pairLeft, pairRight]`, sauf s'ils buteraient
     *  sur la rangée du dessous — une tout autre branche, posée là par un
     *  calcul qui ignore celui-ci. */
    const attachChildren = (kids: string[], pairLeft: number, pairRight: number): void => {
      const width = run(kids.length, SIBLING_GAP);
      const left = (pairLeft + pairRight) / 2 - width / 2;
      const right = left + width;

      if (!rangeFree(generation + 1, left - SIBLING_GAP, right + SIBLING_GAP)) return;

      for (const kid of kids) taken.add(kid);
      lay(kids, left, generation + 1, kids.map(() => SIBLING_STEP), positions);

      // Deux creux de CETTE rangée peuvent chacun révéler des enfants dans
      // la même rangée du dessous : sans mise à jour, le second ne verrait
      // pas ce que le premier vient d'y poser, et pourrait s'y superposer.
      const below = rows.get(generation + 1) ?? [];
      for (const kid of kids) {
        const position = positions.get(kid);
        if (position) below.push(position);
      }
      rows.set(generation + 1, below);
    };

    /**
     * Pose le conjoint caché de `edge` au bord `side` de sa carte, s'il tient
     * dans `[gapLo, gapHi]`, puis les enfants DU COUPLE qu'il forme avec lui.
     *
     * Rend la nouvelle borne du creux du côté où l'on vient de poser — pour
     * que, si les DEUX bords d'un même creux ont chacun un conjoint caché, le
     * second n'aille pas se superposer à ce que le premier vient d'y mettre.
     */
    const attachSpouse = (
      edge: NodePosition,
      side: 'left' | 'right',
      gapLo: number,
      gapHi: number,
    ): number => {
      const spouseId = hiddenSpouse(edge.id);
      const spouseX = side === 'left' ? edge.x - COUPLE_STEP : edge.x + COUPLE_STEP;
      const spouseFits = spouseId && spouseX >= gapLo && spouseX + CARD_WIDTH <= gapHi;
      if (!spouseFits) return side === 'left' ? gapHi : gapLo;

      taken.add(spouseId);
      positions.set(spouseId, { id: spouseId, x: spouseX, y: edge.y, generation });

      const kids = hiddenChildren(edge.id);
      if (kids.length > 0) {
        attachChildren(kids, Math.min(edge.x, spouseX), Math.max(edge.x, spouseX) + CARD_WIDTH);
      }
      return side === 'left' ? spouseX - SIBLING_GAP : spouseX + CARD_WIDTH + SIBLING_GAP;
    };

    // Chaque creux de la rangée, marge extérieure comprise : entre `row[i-1]`
    // (ou rien, à gauche de tout) et `row[i]` (ou rien, à droite de tout).
    // On garde la borne de chacun : la seconde passe, ci-dessous, en a besoin
    // pour les enfants qui n'ont pas de conjoint à côté d'eux.
    const gaps: Array<{ lo: number; hi: number }> = [];
    for (let i = 0; i <= row.length; i += 1) {
      const before = row[i - 1];
      const after = row[i];

      let gapLo = before ? before.x + CARD_WIDTH : Number.NEGATIVE_INFINITY;
      let gapHi = after ? after.x : Number.POSITIVE_INFINITY;

      if (before) gapLo = attachSpouse(before, 'right', gapLo, gapHi);
      if (after) gapHi = attachSpouse(after, 'left', gapLo, gapHi);
      gaps.push({ lo: gapLo, hi: gapHi });
    }

    /*
     * Les enfants de qui n'a PAS de conjoint à révéler — Paul Albertini,
     * enfant direct de « a-1 » sans belle-mère à côté de lui.
     *
     * Chaque carte a deux creux voisins, celui à sa gauche (`gaps[i]`) et
     * celui à sa droite (`gaps[i+1]`). Un premier essai les traitait l'un
     * après l'autre dans une seule passe, gauche d'abord : le creux étroit
     * entre « a » et « a-1 » gagnait alors la carte, avant même que le vide
     * grand ouvert de l'autre côté n'ait sa chance — et la repliait sur le
     * centrage par défaut, collée à François. On regarde maintenant les DEUX
     * creux avant de choisir, et on prend celui qui permet l'écart complet.
     */
    row.forEach((edge, i) => {
      const kids = hiddenChildren(edge.id);
      if (kids.length === 0) return;

      const width = run(kids.length, SIBLING_GAP);
      const leftGap = gaps[i];
      const rightGap = gaps[i + 1];

      const rightBiased = edge.x + CARD_WIDTH + FAMILY_GAP;
      const leftBiased = edge.x - FAMILY_GAP - width;

      let left: number;
      if (rightBiased + width <= rightGap.hi) left = rightBiased;
      else if (leftBiased >= leftGap.lo) left = leftBiased;
      // Aucun des deux creux n'a la place pour un vrai écart : repli sûr,
      // centré sous la carte seule — jamais hors de ses propres bords à
      // elle, donc jamais de quoi croiser une branche voisine.
      else left = edge.x + (CARD_WIDTH - width) / 2;

      attachChildren(kids, left, left + width);
    });
  }
}
