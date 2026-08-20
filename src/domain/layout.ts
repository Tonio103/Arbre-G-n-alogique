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
  cardCenterY,
  cardTop,
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
  unions: LayoutUnion[];
  crossLinks: CrossLink[];
  bounds: Bounds;
  rows: GenerationRow[];
  /** Ordre de dessin des liens : les unions d'abord, indexées par personne. */
  unionsByPerson: Map<string, string[]>;
  unionById: Map<string, LayoutUnion>;
}

interface PlacementNode {
  anchorId: string;
  /** Personnes du bloc, de gauche à droite (conjoints inclus). */
  members: string[];
  /** Sous-arbres enfants, dans l'ordre horizontal. */
  childNodes: PlacementNode[];
  generation: number;
  blockWidth: number;
  subtreeWidth: number;
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
      subtreeWidth: 0,
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

function measure(node: PlacementNode): number {
  let childrenWidth = 0;
  for (let i = 0; i < node.childNodes.length; i += 1) {
    childrenWidth += measure(node.childNodes[i]);
    if (i > 0) childrenWidth += SIBLING_GAP;
  }
  node.subtreeWidth = Math.max(node.blockWidth, childrenWidth);
  return node.subtreeWidth;
}

/**
 * Assigne les coordonnées. Le bloc parent et le groupe d'enfants sont centrés
 * sur le même axe, ce qui aligne naturellement un couple au-dessus de sa
 * descendance sans passe de correction.
 */
function assign(
  node: PlacementNode,
  left: number,
  positions: Map<string, NodePosition>,
  graph: FamilyGraph,
): void {
  const blockLeft = left + (node.subtreeWidth - node.blockWidth) / 2;
  let cursor = blockLeft;
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

  let childrenWidth = 0;
  for (let i = 0; i < node.childNodes.length; i += 1) {
    childrenWidth += node.childNodes[i].subtreeWidth;
    if (i > 0) childrenWidth += SIBLING_GAP;
  }

  let childCursor = left + (node.subtreeWidth - childrenWidth) / 2;
  for (const child of node.childNodes) {
    assign(child, childCursor, positions, graph);
    childCursor += child.subtreeWidth + SIBLING_GAP;
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

  let cursor = 0;
  for (const root of roots) {
    measure(root);
    assign(root, cursor, positions, graph);
    cursor += root.subtreeWidth + FAMILY_GAP;
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

    const sameRow =
      partners.length < 2 || Math.abs(partners[0].y - partners[partners.length - 1].y) < 1;
    const span = partners.length > 1 ? partners[partners.length - 1].x - partners[0].x : 0;
    const adjacent = sameRow && span <= CARD_WIDTH + COUPLE_GAP + 1;

    const anchorX =
      partners.length > 1 && adjacent
        ? (cardCenterX(partners[0].x) + cardCenterX(partners[partners.length - 1].x)) / 2
        : cardCenterX(partners[0].x);
    // Pour un couple, la descendance part du trait qui relie les deux cartes ;
    // pour un parent seul, du bas de sa carte.
    const anchorY =
      partners.length > 1 && adjacent
        ? cardCenterY(Math.max(...partners.map((p) => p.y)))
        : cardBottom(partners[0].y);

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
    regions: computeRegions(graph, positions),
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
): LayoutRegion[] {
  const regions: LayoutRegion[] = [];

  for (const branch of graph.branches) {
    const anchor = graph.people.get(branch.anchorId);
    const anchorPosition = positions.get(branch.anchorId);
    if (!anchor || !anchorPosition) continue;

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

    regions.push({
      label: branch.label,
      anchorId: branch.anchorId,
      minX,
      maxX,
      centerX: (minX + maxX) / 2,
      y: anchorPosition.y,
      count: seen.size,
    });
  }

  return regions.sort((a, b) => a.minX - b.minX);
}
