import type { FamilyGraph } from './graph';
import { computePlacement } from './placement';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  COUPLE_GAP,
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
  /**
   * Étage du trait distributeur, pour ne pas se confondre avec celui d'une
   * autre famille — voir `assignBusLanes`.
   */
  busLane: number;
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

/**
 * Donne à chaque famille son propre étage de trait.
 *
 * Le trait qui distribue une fratrie court à mi-chemin entre la rangée des
 * parents et celle des enfants. À la même hauteur pour toutes les familles
 * d'une même rangée, deux traits dont les portées se croisent se rejoignent
 * en une seule ligne continue — et le dessin se met à mentir : les enfants de
 * l'une paraissent pendre du trait de l'autre, donc être frères et sœurs de
 * gens qui ne le sont pas. Sur l'arbre qui a servi de référence, quatorze
 * traits sur trente se confondaient ainsi, dont ceux des parents de deux
 * conjoints — qui semblaient du coup frère et sœur.
 *
 * Les familles dont les portées se recouvrent sont donc réparties sur des
 * étages distincts, au plus près les unes des autres : c'est le rangement
 * classique par intervalles, celui d'un agenda qui empile les rendez-vous qui
 * se chevauchent. Une famille dont la portée est libre reste à l'étage zéro,
 * la hauteur naturelle.
 */
function assignBusLanes(unions: LayoutUnion[]): void {
  const byChildRow = new Map<number, LayoutUnion[]>();
  for (const union of unions) {
    if (union.children.length === 0) continue;
    const childTop = Math.min(...union.children.map((child) => child.y));
    const group = byChildRow.get(childTop) ?? [];
    group.push(union);
    byChildRow.set(childTop, group);
  }

  for (const group of byChildRow.values()) {
    const spans = group
      .map((union) => ({
        union,
        min: Math.min(union.anchorX, ...union.children.map((child) => cardCenterX(child.x))),
        max: Math.max(union.anchorX, ...union.children.map((child) => cardCenterX(child.x))),
      }))
      .sort((a, b) => a.min - b.min || a.max - b.max);

    // Dernière abscisse occupée par chaque étage : un trait reprend le premier
    // étage libéré avant lui, et n'en ouvre un nouveau qu'à défaut.
    const laneEnds: number[] = [];
    for (const span of spans) {
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] > span.min - SIBLING_GAP) lane += 1;
      laneEnds[lane] = span.max;
      span.union.busLane = lane;
    }
  }
}

const decadeLabel = (years: number[]): string => {
  if (years.length === 0) return '';
  const sorted = [...years].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return `${Math.floor(median / 10) * 10}s`;
};

export function computeLayout(graph: FamilyGraph): TreeLayout {
  // Le placement lui-même vit dans `placement.ts` : une bande horizontale par
  // famille, où nulle autre n'entre. Tout ce qui suit ne fait qu'en déduire
  // les traits, les repères et le cadre.
  const { positions, secondaryLinks, detachedFiliations } = computePlacement(graph);

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
    /*
     * Les enfants que cette union dessine réellement.
     *
     * Un enfant dont la place est portée par l'autre famille est écarté ici :
     * il est relié par un renvoi (voir `detachedFiliations`). Le garder ferait
     * tracer en plus un trait plein d'un bout à l'autre de l'arbre — le renvoi
     * s'ajouterait au trait au lieu de le remplacer.
     */
    const children = union.children
      .filter((childId) => !union.partners.some((p) => detachedFiliations.has(`${p}>${childId}`)))
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
     * Le point d'où part la descendance : le milieu du couple quand les deux
     * cartes sont voisines — mais seulement alors. Un mariage entre deux
     * branches (`adjacent` faux) n'a pas de bloc commun : `buildPlacementForest`
     * rattache les enfants au sous-arbre d'un seul des deux parents, celui qui
     * les a rencontrés en premier (voir plus haut, « la première visite emporte
     * les enfants »). Centrer entre les deux cartes déplacerait le départ de la
     * descente loin de l'endroit où les enfants sont réellement placés — un
     * détour qui n'existe que sur le papier, pas dans la disposition.
     */
    const anchorX =
      partners.length > 1 && adjacent
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
      busLane: 0,
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

  /*
   * Les filiations que la bande ne peut pas porter.
   *
   * Une personne n'occupe qu'une place, mais ses deux parents peuvent vivre
   * dans deux familles différentes — c'est le cas dès que les deux conjoints
   * d'un couple ont eux-mêmes des parents connus. Le lien vers le second se
   * trace donc à part, en pointillé, comme sur un arbre imprimé : mieux vaut
   * un trait qui s'annonce comme un renvoi qu'un trait plein qui traverse
   * l'arbre en prétendant être une descente.
   */
  for (const link of secondaryLinks) {
    const parent = partnerOf(link.parentId);
    const child = partnerOf(link.childId);
    if (!parent || !child) continue;
    crossLinks.push({ id: `p:${link.parentId}>${link.childId}`, a: parent, b: child, status: 'unknown' });
  }

  // Chaque famille sur son propre étage, pour que deux traits de filiation
  // ne se confondent jamais — voir `assignBusLanes`.
  assignBusLanes(layoutUnions);

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
