import type { FamilyGraph } from './graph';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  COUPLE_GAP,
  FAMILY_GAP,
  ROW_HEIGHT,
  SIBLING_GAP,
  cardBottom,
  cardCenterX,
  cardTop,
  portraitCenterY,
  portraitTop,
} from '@/view/metrics';

export interface NodePosition {
  id: string;
  x: number;
  y: number;
  generation: number;
}

export interface LayoutPartner {
  id: string;
  x: number;
  y: number;
}

export interface LayoutUnion {
  id: string;
  partners: LayoutPartner[];
  children: LayoutPartner[];
  /** Point d'où part la descendance. */
  anchorX: number;
  anchorY: number;
  /** Vrai quand les deux conjoints sont côte à côte (cas courant). */
  adjacent: boolean;
  status: string;
}

/** Mariage reliant deux branches éloignées : dessiné en courbe pointillée. */
export interface CrossLink {
  id: string;
  a: LayoutPartner;
  b: LayoutPartner;
  status: string;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GenerationRow {
  generation: number;
  y: number;
  count: number;
  /** Décennie médiane des naissances, pour étiqueter la frise. */
  label: string;
}

/** Étendue occupée par une branche nommée, pour l'étiqueter en vue éloignée. */
export interface LayoutRegion {
  label: string;
  anchorId: string;
  minX: number;
  maxX: number;
  centerX: number;
  /** Haut de la région : la génération de l'ancêtre qui lui donne son nom. */
  y: number;
  count: number;
}

export interface TreeLayout {
  positions: Map<string, NodePosition>;
  regions: LayoutRegion[];
  /** Nombre de descendants de chaque personne. */
  weights: Map<string, number>;
  unions: LayoutUnion[];
  crossLinks: CrossLink[];
  bounds: Bounds;
  rows: GenerationRow[];
  /** Ordre de dessin des liens : les unions d'abord, indexées par personne. */
  unionsByPerson: Map<string, string[]>;
  unionById: Map<string, LayoutUnion>;
  /**
   * Lignée fondatrice de chaque personne, par son rang dans `graph.branches`.
   *
   * C'est ce qui donne sa couleur à une carte. Un diagramme monochrome de cinq
   * cents personnes ne laisse voir aucune structure : on ne distingue une
   * famille d'une autre qu'en suivant les traits un par un. Une teinte par
   * lignée rend cette structure lisible d'un seul regard, sans rien ajouter au
   * dessin.
   */
  branchOf: Map<string, number>;
}

interface PlacementNode {
  anchorId: string;
  /** Personnes du bloc, de gauche à droite (conjoints inclus). */
  members: string[];
  /** Sous-arbres enfants, dans l'ordre horizontal. */
  childNodes: PlacementNode[];
  generation: number;
  blockWidth: number;
  /** Position du bloc, relative à l'origine locale du sous-arbre. */
  blockOffset: number;
  /** Décalage de ce sous-arbre par rapport à l'origine de son parent. */
  offset: number;
  contour: Contour;
}

/**
 * Place chaque personne une seule fois.
 *
 * Une personne mariée dans la famille apparaît à côté de son conjoint ; une
 * personne née dans la famille apparaît sous ses parents. Quand les deux
 * conjoints sont nés dans l'arbre, le premier rencontré garde sa place et
 * l'union devient un lien croisé — ce que fait aussi un arbre sur papier.
 */
function buildPlacementForest(graph: FamilyGraph): PlacementNode[] {
  const { people, unions } = graph;
  const placed = new Set<string>();
  const placedUnions = new Set<string>();
  const roots: PlacementNode[] = [];

  // Nombre de descendants, par programmation dynamique : `graph.order` étant trié
  // par génération, le parcourir à l'envers garantit que les enfants sont comptés
  // avant leurs parents.
  const descendantCount = new Map<string, number>();
  for (let i = graph.order.length - 1; i >= 0; i -= 1) {
    const id = graph.order[i];
    let total = 0;
    for (const childId of people.get(id)?.children ?? []) {
      total += 1 + (descendantCount.get(childId) ?? 0);
    }
    descendantCount.set(id, total);
  }

  const makeNode = (anchorId: string): PlacementNode => {
    placed.add(anchorId);
    const person = people.get(anchorId)!;

    // Conjoints encore libres : ils rejoignent le bloc de cette personne.
    // Un conjoint dont les parents figurent dans l'arbre garde en revanche sa
    // place dans sa propre lignée ; son mariage devient alors un lien croisé.
    const attachedSpouses: string[] = [];
    for (const unionId of person.unionIds) {
      const union = unions.get(unionId);
      if (!union) continue;
      const partnerId = union.partners.find((p) => p !== anchorId);
      if (!partnerId) continue;
      if (placed.has(partnerId)) continue;
      if ((people.get(partnerId)?.parents.length ?? 0) > 0) continue;
      placed.add(partnerId);
      attachedSpouses.push(partnerId);
    }

    // Un seul conjoint : à droite. Plusieurs : encadrent l'ancre.
    let members: string[];
    if (attachedSpouses.length === 0) {
      members = [anchorId];
    } else if (attachedSpouses.length === 1) {
      members = [anchorId, attachedSpouses[0]];
    } else {
      members = [attachedSpouses[0], anchorId, ...attachedSpouses.slice(1)];
    }

    const node: PlacementNode = {
      anchorId,
      members,
      childNodes: [],
      generation: person.generation,
      blockWidth: members.length * CARD_WIDTH + (members.length - 1) * COUPLE_GAP,
      blockOffset: 0,
      offset: 0,
      contour: { left: [0], right: [0] },
    };

    // Descendance : toute union d'un membre du bloc que personne n'a encore
    // prise en charge. La première visite emporte les enfants, ce qui garantit
    // qu'aucun enfant n'est oublié même quand ses parents sont dans deux branches.
    const relevantUnions: string[] = [];
    for (const memberId of members) {
      for (const unionId of people.get(memberId)?.unionIds ?? []) {
        if (!unions.has(unionId)) continue;
        if (placedUnions.has(unionId) || relevantUnions.includes(unionId)) continue;
        relevantUnions.push(unionId);
      }
    }

    for (const unionId of relevantUnions) {
      const union = unions.get(unionId)!;
      placedUnions.add(unionId);
      for (const childId of union.children) {
        if (placed.has(childId)) continue;
        node.childNodes.push(makeNode(childId));
      }
    }

    return node;
  };

  // Racines : les plus anciennes générations d'abord, les lignées les plus
  // fournies en tête, pour que l'arbre principal soit dessiné en premier.
  const candidates = [...graph.order].sort((a, b) => {
    const pa = people.get(a)!;
    const pb = people.get(b)!;
    const rootA = pa.parents.length === 0 ? 0 : 1;
    const rootB = pb.parents.length === 0 ? 0 : 1;
    if (rootA !== rootB) return rootA - rootB;
    if (pa.generation !== pb.generation) return pa.generation - pb.generation;
    const da = descendantCount.get(a) ?? 0;
    const db = descendantCount.get(b) ?? 0;
    if (da !== db) return db - da;
    return a.localeCompare(b);
  });

  for (const id of candidates) {
    if (placed.has(id)) continue;
    roots.push(makeNode(id));
  }

  return roots;
}

/**
 * Place les sous-arbres par contours plutôt qu'en bandes exclusives.
 *
 * Le placement naïf réserve à chaque sous-arbre une bande où nul autre n'entre.
 * Une personne sans descendance monopolise alors une colonne sur toute la
 * hauteur de l'arbre, et la largeur totale finit par valoir le nombre de
 * feuilles plutôt que la population de la génération la plus fournie — deux
 * fois et demie l'espace nécessaire, dans ce jeu de données. Les branches
 * doivent parcourir cette largeur en une génération de hauteur, ce qui les
 * couche à l'horizontale.
 *
 * On garde donc, pour chaque sous-arbre, la silhouette de ses bords gauche et
 * droit, niveau par niveau. Deux voisins ne s'écartent alors que de ce que
 * leurs silhouettes exigent réellement : une branche courte se glisse sous la
 * ramure de sa voisine au lieu de la pousser.
 */
interface Contour {
  /** Bord gauche, par profondeur relative au nœud (0 = sa propre rangée). */
  left: number[];
  right: number[];
}

function measure(node: PlacementNode): void {
  if (node.childNodes.length === 0) {
    node.blockOffset = 0;
    node.contour = { left: [0], right: [node.blockWidth] };
    return;
  }

  const merged: Contour = { left: [], right: [] };

  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    measure(child);

    if (i === 0) {
      child.offset = 0;
    } else {
      // Décalage minimal : le plus grand empiètement constaté sur les niveaux
      // que les deux silhouettes ont en commun.
      let shift = 0;
      const shared = Math.min(merged.right.length, child.contour.left.length);
      for (let d = 0; d < shared; d += 1) {
        shift = Math.max(shift, merged.right[d] - child.contour.left[d] + SIBLING_GAP);
      }
      child.offset = shift;
    }

    for (let d = 0; d < child.contour.left.length; d += 1) {
      const left = child.contour.left[d] + child.offset;
      const right = child.contour.right[d] + child.offset;
      if (d < merged.left.length) {
        merged.left[d] = Math.min(merged.left[d], left);
        merged.right[d] = Math.max(merged.right[d], right);
      } else {
        merged.left.push(left);
        merged.right.push(right);
      }
    }
  }

  // Le parent se centre sur la rangée de ses enfants — pas sur leur silhouette
  // entière, qui peut déborder très loin à cause d'une descendance lointaine.
  const first = node.childNodes[0];
  const last = node.childNodes[node.childNodes.length - 1];
  const childrenCenter =
    (first.offset + first.contour.left[0] + last.offset + last.contour.right[0]) / 2;
  node.blockOffset = childrenCenter - node.blockWidth / 2;

  node.contour = {
    left: [node.blockOffset, ...merged.left],
    right: [node.blockOffset + node.blockWidth, ...merged.right],
  };
}

/** Étendue horizontale réellement occupée par un sous-arbre. */
function contourSpan(node: PlacementNode): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let d = 0; d < node.contour.left.length; d += 1) {
    min = Math.min(min, node.contour.left[d]);
    max = Math.max(max, node.contour.right[d]);
  }
  return { min, max };
}

/**
 * Assigne les coordonnées définitives à partir des décalages calculés.
 *
 * Les générations sont des rangées régulières : la plus ancienne en haut, la
 * descendance en dessous. C'est la disposition de tous les arbres
 * généalogiques imprimés, et sa lisibilité tient précisément à cette
 * régularité — on suit une filiation en descendant, une fratrie en balayant
 * une ligne. Rien n'est décalé, courbé ni dispersé : ce qui doit se voir ici,
 * c'est la structure, pas une silhouette.
 *
 * `origin` est la position, en coordonnées du monde, de l'origine locale du
 * sous-arbre — celle à laquelle contours et décalages se rapportent.
 */
function assign(
  node: PlacementNode,
  origin: number,
  positions: Map<string, NodePosition>,
  graph: FamilyGraph,
): void {
  let cursor = origin + node.blockOffset;

  for (const memberId of node.members) {
    const generation = graph.people.get(memberId)?.generation ?? node.generation;
    positions.set(memberId, {
      id: memberId,
      x: cursor,
      y: generation * ROW_HEIGHT,
      generation,
    });
    cursor += CARD_WIDTH + COUPLE_GAP;
  }

  for (const child of node.childNodes) {
    assign(child, origin + child.offset, positions, graph);
  }
}


const decadeLabel = (years: number[]): string => {
  if (years.length === 0) return '';
  const sorted = [...years].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return `${Math.floor(median / 10) * 10}s`;
};

export function computeLayout(graph: FamilyGraph): TreeLayout {
  const roots = buildPlacementForest(graph);
  const positions = new Map<string, NodePosition>();

  // Nombre de descendants par personne, calculé de bas en haut de l'ordre
  // topologique : les enfants sont toujours comptés avant leurs parents.
  const weights = new Map<string, number>();
  for (let i = graph.order.length - 1; i >= 0; i -= 1) {
    const id = graph.order[i];
    let total = 0;
    for (const childId of graph.people.get(id)?.children ?? []) {
      total += 1 + (weights.get(childId) ?? 0);
    }
    weights.set(id, total);
  }

  let cursor = 0;
  for (const root of roots) {
    measure(root);
    const span = contourSpan(root);
    // L'origine se cale pour que le bord gauche réel du sous-arbre tombe
    // exactement sur le curseur.
    assign(root, cursor - span.min, positions, graph);
    cursor += span.max - span.min + FAMILY_GAP;
  }

  // Filet de sécurité : personne ne doit rester sans coordonnées.
  for (const id of graph.order) {
    if (positions.has(id)) continue;
    const generation = graph.people.get(id)?.generation ?? 0;
    positions.set(id, { id, x: cursor, y: generation * ROW_HEIGHT, generation });
    cursor += CARD_WIDTH + SIBLING_GAP;
  }

  // --- Liens ---
  const layoutUnions: LayoutUnion[] = [];
  const crossLinks: CrossLink[] = [];
  const unionsByPerson = new Map<string, string[]>();
  const unionById = new Map<string, LayoutUnion>();

  const partnerOf = (id: string): LayoutPartner | undefined => {
    const position = positions.get(id);
    return position ? { id, x: position.x, y: position.y } : undefined;
  };

  for (const union of graph.unions.values()) {
    const partners = union.partners
      .map(partnerOf)
      .filter((p): p is LayoutPartner => Boolean(p))
      .sort((a, b) => a.x - b.x);
    const children = union.children
      .map(partnerOf)
      .filter((c): c is LayoutPartner => Boolean(c))
      .sort((a, b) => a.x - b.x);

    if (partners.length === 0) continue;

    // Tolérance calée sur le décalage de rangée : deux conjoints d'un même bloc
    // le partagent, mais un mariage entre deux branches réunit deux blocs qui
    // ne l'ont pas — et ce couple-là doit tout de même se lire comme un couple.
    const sameRow =
      partners.length < 2 ||
      Math.abs(partners[0].y - partners[partners.length - 1].y) < ROW_HEIGHT * 0.25;
    const span = partners.length > 1 ? partners[partners.length - 1].x - partners[0].x : 0;
    const adjacent = sameRow && span <= CARD_WIDTH + COUPLE_GAP + 1;

    /*
     * Le point d'où part la descendance est toujours le milieu du couple —
     * `adjacent` ne conditionne que le trait d'alliance visible (voir
     * `unionSegments` dans `view/links.ts`), pas ce point-ci. Un mariage
     * entre deux branches, dont les cartes sont trop loin l'une de l'autre
     * pour un trait direct, a quand même un milieu : sans lui, la descente
     * partait uniquement de sous le premier partenaire, comme si l'enfant
     * n'avait qu'un parent.
     */
    const anchorX =
      partners.length > 1
        ? (cardCenterX(partners[0].x) + cardCenterX(partners[partners.length - 1].x)) / 2
        : cardCenterX(partners[0].x);
    // L'arbre pousse vers le haut : la descendance part du trait qui relie les
    // deux cartes, ou du haut de la carte pour un parent seul.
    const anchorY =
      partners.length > 1 && adjacent
        ? portraitCenterY(Math.min(...partners.map((p) => p.y)))
        : portraitTop(partners[0].y);

    const layoutUnion: LayoutUnion = {
      id: union.id,
      partners,
      children,
      anchorX,
      anchorY,
      adjacent,
      status: union.status,
    };
    layoutUnions.push(layoutUnion);
    unionById.set(union.id, layoutUnion);

    for (const partner of partners) {
      const list = unionsByPerson.get(partner.id) ?? [];
      list.push(union.id);
      unionsByPerson.set(partner.id, list);
    }
    for (const child of children) {
      const list = unionsByPerson.get(child.id) ?? [];
      list.push(union.id);
      unionsByPerson.set(child.id, list);
    }

    if (partners.length > 1 && !adjacent) {
      crossLinks.push({
        id: union.id,
        a: partners[0],
        b: partners[partners.length - 1],
        status: union.status,
      });
    }
  }

  const branchOf = new Map<string, number>();

  // --- Cadre et frise des générations ---
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const yearsByGeneration = new Map<number, number[]>();
  const countByGeneration = new Map<number, number>();

  for (const position of positions.values()) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, cardTop(position.y));
    maxX = Math.max(maxX, position.x + CARD_WIDTH);
    maxY = Math.max(maxY, cardBottom(position.y));
    countByGeneration.set(position.generation, (countByGeneration.get(position.generation) ?? 0) + 1);
    const year = graph.people.get(position.id)?.birthYear;
    if (year) {
      const list = yearsByGeneration.get(position.generation) ?? [];
      list.push(year);
      yearsByGeneration.set(position.generation, list);
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = CARD_WIDTH;
    maxY = CARD_HEIGHT;
  }

  const rows: GenerationRow[] = [...countByGeneration.keys()]
    .sort((a, b) => a - b)
    .map((generation) => ({
      generation,
      y: generation * ROW_HEIGHT,
      count: countByGeneration.get(generation) ?? 0,
      label: decadeLabel(yearsByGeneration.get(generation) ?? []),
    }));


  return {
    positions,
    regions: computeRegions(graph, positions, branchOf),
    branchOf,
    weights,
    unions: layoutUnions,
    crossLinks,
    bounds: { minX, minY, maxX, maxY },
    rows,
    unionsByPerson,
    unionById,
  };
}

/**
 * Étendue horizontale de chaque branche nommée : son ancêtre, ses conjoints et
 * toute sa descendance. Les branches dont les membres sont dispersés (cas d'un
 * mariage entre lignées) sont écartées, car une étiquette couvrant la moitié de
 * l'arbre n'apprendrait rien.
 */
function computeRegions(
  graph: FamilyGraph,
  positions: Map<string, NodePosition>,
  branchOf: Map<string, number>,
): LayoutRegion[] {
  const regions: LayoutRegion[] = [];

  /*
   * La lignée la plus étroite l'emporte.
   *
   * Les branches s'emboîtent : la souche d'origine contient tout le monde, une
   * sous-branche n'en contient qu'une part. À attribuer la couleur au premier
   * venu, la souche prend cinq cents personnes sur cinq cent vingt-huit et le
   * diagramme redevient monochrome. On attribue donc de la plus large à la
   * plus étroite, si bien que c'est la dernière — la plus précise, celle qui
   * distingue vraiment une famille de sa voisine — qui reste.
   */
  const claimed: Array<{ index: number; members: Set<string> }> = [];

  graph.branches.forEach((branch, index) => {
    const anchor = graph.people.get(branch.anchorId);
    const anchorPosition = positions.get(branch.anchorId);
    if (!anchor || !anchorPosition) return;

    const seen = new Set<string>([branch.anchorId]);
    const queue = [branch.anchorId];
    let minX = anchorPosition.x;
    let maxX = anchorPosition.x + CARD_WIDTH;

    while (queue.length > 0) {
      const id = queue.pop()!;
      const person = graph.people.get(id);
      if (!person) continue;
      const position = positions.get(id);
      if (position) {
        minX = Math.min(minX, position.x);
        maxX = Math.max(maxX, position.x + CARD_WIDTH);
      }
      for (const nextId of [...person.children, ...person.spouseLinks.map((l) => l.id)]) {
        if (seen.has(nextId)) continue;
        // Un conjoint venu d'ailleurs n'entraîne pas sa propre lignée.
        if (person.spouseLinks.some((l) => l.id === nextId) && graph.people.get(nextId)?.parents.length) {
          continue;
        }
        seen.add(nextId);
        queue.push(nextId);
      }
    }

    claimed.push({ index, members: seen });

    regions.push({
      label: branch.label,
      anchorId: branch.anchorId,
      minX,
      maxX,
      centerX: (minX + maxX) / 2,
      y: anchorPosition.y,
      count: seen.size,
    });
  });

  claimed.sort((a, b) => b.members.size - a.members.size);
  for (const entry of claimed) {
    for (const id of entry.members) branchOf.set(id, entry.index);
  }

  return regions.sort((a, b) => a.minX - b.minX);
}
