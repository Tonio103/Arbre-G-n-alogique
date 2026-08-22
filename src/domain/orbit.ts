import { hashN } from '@/lib/hash';
import type { FamilyGraph } from './graph';

/*
 * ============================================================================
 *
 *  PLACEMENT RADIAL EN TROIS DIMENSIONS
 *
 *  Toute la difficulté d'un arbre généalogique dessiné à plat tient en une
 *  phrase : une génération est une altitude, et une altitude n'a qu'une seule
 *  dimension libre. Cent personnes nées la même décennie doivent donc se
 *  ranger sur une ligne, et une ligne de cent personnes est une barre — pas
 *  une branche. Aucun dessin, aucune courbe, aucune épaisseur de bois ne
 *  rattrape cela : la barre est dans la géométrie, pas dans le trait.
 *
 *  En trois dimensions, cette contrainte disparaît. Une génération n'est plus
 *  une ligne mais un anneau : les cent personnes se répartissent tout autour
 *  de l'axe, et il n'existe plus aucun point de vue depuis lequel elles
 *  s'alignent. Le problème n'est pas corrigé, il est dissous.
 *
 *  Chaque lignée reçoit un secteur angulaire proportionnel à ce qu'elle porte,
 *  et le partage entre ses enfants : c'est la même règle à toutes les échelles,
 *  du tronc au dernier rameau.
 *
 * ==========================================================================*/

export interface OrbitPerson {
  id: string;
  /** Angle autour de l'axe, en radians. */
  angle: number;
  /** Distance à l'axe. */
  radius: number;
  /** Altitude : zéro au sol, croissante vers la cime. */
  height: number;
  generation: number;
  /** Descendants portés : c'est l'épaisseur de la branche. */
  weight: number;
  /** Position cartésienne, pré-calculée une fois pour toutes. */
  x: number;
  y: number;
  z: number;
}

export type OrbitLinkKind = 'descent' | 'union';

export interface OrbitLink {
  from: string;
  to: string;
  kind: OrbitLinkKind;
  /** Épaisseur du bois au départ et à l'arrivée. */
  fromWidth: number;
  toWidth: number;
}

export interface OrbitLayout {
  people: Map<string, OrbitPerson>;
  links: OrbitLink[];
  /** Sommet du fût, d'où partent les lignées fondatrices. */
  trunkTop: number;
  trunkWidth: number;
  maxRadius: number;
  topHeight: number;
}

/*
 * Les proportions de l'arbre, en unités de monde.
 *
 * Elles ne veulent rien dire dans l'absolu — seule compte leur relation. Un
 * fût qui vaut le tiers de la hauteur totale et un rayon de couronne qui vaut
 * les deux tiers de cette même hauteur donnent la silhouette d'un arbre isolé
 * en pleine terre, celui qui a eu la place de s'étaler.
 */
const TRUNK_RISE = 3.2;
const CROWN_RISE = 11.5;
const CROWN_RADIUS = 5.4;
/** Rayon des fondateurs : non nul, sinon toute la première génération se superpose. */
const ROOT_RADIUS = 0.55;

/** L'étagement : large en bas, serré en haut, comme toute ramification. */
const heightCurve = (t: number): number => Math.pow(t, 0.82);
/** L'évasement : lent au départ, puis la couronne s'ouvre. */
const radiusCurve = (t: number): number => Math.pow(t, 0.72);

/** Épaisseur d'une branche d'après ce qu'elle porte. */
export const limbWidth = (carried: number): number =>
  0.007 + 0.028 * Math.sqrt(Math.max(0, carried));

interface Node {
  id: string;
  members: string[];
  children: Node[];
  generation: number;
  /** Nombre total de personnes sous ce nœud, conjoints compris. */
  span: number;
}

/**
 * Construit la forêt de placement : chaque personne une seule fois.
 *
 * Un conjoint entré dans la famille rejoint le bloc de celui qu'il épouse ;
 * un conjoint qui a lui-même ses parents dans l'arbre garde sa place dans sa
 * propre lignée, et son mariage devient un simple trait entre les deux.
 */
function buildForest(graph: FamilyGraph): Node[] {
  const { people, unions } = graph;
  const placed = new Set<string>();
  const claimedUnions = new Set<string>();

  const makeNode = (anchorId: string): Node => {
    placed.add(anchorId);
    const person = people.get(anchorId)!;

    const spouses: string[] = [];
    for (const unionId of person.unionIds) {
      const union = unions.get(unionId);
      if (!union) continue;
      const partnerId = union.partners.find((p) => p !== anchorId);
      if (!partnerId || placed.has(partnerId)) continue;
      if ((people.get(partnerId)?.parents.length ?? 0) > 0) continue;
      placed.add(partnerId);
      spouses.push(partnerId);
    }

    const node: Node = {
      id: anchorId,
      members: [anchorId, ...spouses],
      children: [],
      generation: person.generation,
      span: 0,
    };

    for (const memberId of node.members) {
      for (const unionId of people.get(memberId)?.unionIds ?? []) {
        if (!unions.has(unionId) || claimedUnions.has(unionId)) continue;
        claimedUnions.add(unionId);
        for (const childId of unions.get(unionId)!.children) {
          if (placed.has(childId)) continue;
          node.children.push(makeNode(childId));
        }
      }
    }

    return node;
  };

  const measure = (node: Node): number => {
    let span = node.members.length;
    for (const child of node.children) span += measure(child);
    node.span = span;
    return span;
  };

  // Les lignées les plus fournies d'abord : elles prennent les plus larges
  // secteurs, et l'arbre se lit du plus gros au plus fin.
  const descendants = new Map<string, number>();
  for (let i = graph.order.length - 1; i >= 0; i -= 1) {
    const id = graph.order[i];
    let total = 0;
    for (const childId of people.get(id)?.children ?? []) {
      total += 1 + (descendants.get(childId) ?? 0);
    }
    descendants.set(id, total);
  }

  const candidates = [...graph.order].sort((a, b) => {
    const pa = people.get(a)!;
    const pb = people.get(b)!;
    const rootA = pa.parents.length === 0 ? 0 : 1;
    const rootB = pb.parents.length === 0 ? 0 : 1;
    if (rootA !== rootB) return rootA - rootB;
    if (pa.generation !== pb.generation) return pa.generation - pb.generation;
    const da = descendants.get(a) ?? 0;
    const db = descendants.get(b) ?? 0;
    if (da !== db) return db - da;
    return a.localeCompare(b);
  });

  const roots: Node[] = [];
  for (const id of candidates) {
    if (placed.has(id)) continue;
    roots.push(makeNode(id));
  }
  for (const root of roots) measure(root);
  return roots;
}

export function computeOrbit(graph: FamilyGraph): OrbitLayout {
  const weights = new Map<string, number>();
  for (let i = graph.order.length - 1; i >= 0; i -= 1) {
    const id = graph.order[i];
    let total = 0;
    for (const childId of graph.people.get(id)?.children ?? []) {
      total += 1 + (weights.get(childId) ?? 0);
    }
    weights.set(id, total);
  }

  let depth = 1;
  for (const generation of graph.generations) depth = Math.max(depth, generation);

  const people = new Map<string, OrbitPerson>();
  const links: OrbitLink[] = [];
  const roots = buildForest(graph);

  const place = (id: string, angle: number, generation: number): OrbitPerson => {
    const t = Math.min(1, Math.max(0, generation / depth));
    // Le désordre : sans lui, chaque génération est un anneau parfait, et
    // l'arbre redevient une architecture — des étages, pas une ramure.
    const wobbleR = (hashN(id, 11) - 0.5) * 0.9;
    const wobbleH = (hashN(id, 12) - 0.5) * 0.62;

    const radius = ROOT_RADIUS + (CROWN_RADIUS - ROOT_RADIUS) * radiusCurve(t) + wobbleR;
    const height = TRUNK_RISE + CROWN_RISE * heightCurve(t) + wobbleH;

    const person: OrbitPerson = {
      id,
      angle,
      radius: Math.max(0.05, radius),
      height,
      generation,
      weight: weights.get(id) ?? 0,
      x: Math.cos(angle) * Math.max(0.05, radius),
      y: height,
      z: Math.sin(angle) * Math.max(0.05, radius),
    };
    people.set(id, person);
    return person;
  };

  /**
   * Distribue un nœud et sa descendance dans le secteur qui lui est alloué.
   *
   * Le secteur d'un enfant est proportionnel au nombre de personnes qu'il
   * porte : une lignée de deux cents personnes reçoit deux cents fois plus de
   * ciel qu'un rameau qui s'arrête. C'est la seule règle, et elle suffit à ce
   * qu'aucune branche n'en écrase une autre.
   */
  const spread = (node: Node, from: number, to: number): void => {
    const middle = (from + to) / 2;
    const width = to - from;

    // Les conjoints se posent de part et d'autre de l'ancre, dans son secteur.
    const step = node.members.length > 1 ? Math.min(width * 0.34, 0.055) : 0;
    node.members.forEach((memberId, index) => {
      const offset = (index - (node.members.length - 1) / 2) * step;
      const generation = graph.people.get(memberId)?.generation ?? node.generation;
      place(memberId, middle + offset, generation);
    });

    // Le trait d'alliance, entre conjoints voisins.
    for (let i = 1; i < node.members.length; i += 1) {
      links.push({
        from: node.members[i - 1],
        to: node.members[i],
        kind: 'union',
        fromWidth: limbWidth(1),
        toWidth: limbWidth(1),
      });
    }

    if (node.children.length === 0) return;

    let total = 0;
    for (const child of node.children) total += child.span;

    let cursor = from;
    for (const child of node.children) {
      const share = total > 0 ? (child.span / total) * width : width / node.children.length;
      spread(child, cursor, cursor + share);
      cursor += share;

      links.push({
        from: node.id,
        to: child.id,
        kind: 'descent',
        fromWidth: limbWidth(1 + (weights.get(node.id) ?? 0)),
        toWidth: limbWidth(1 + (weights.get(child.id) ?? 0)),
      });
    }
  };

  let totalSpan = 0;
  for (const root of roots) totalSpan += root.span;

  let cursor = 0;
  for (const root of roots) {
    const share = totalSpan > 0 ? (root.span / totalSpan) * Math.PI * 2 : 0;
    spread(root, cursor, cursor + share);
    cursor += share;
  }

  // Filet : personne ne reste sans coordonnées.
  for (const id of graph.order) {
    if (people.has(id)) continue;
    place(id, hashN(id, 3) * Math.PI * 2, graph.people.get(id)?.generation ?? 0);
  }

  let maxRadius = 0;
  let topHeight = 0;
  for (const person of people.values()) {
    maxRadius = Math.max(maxRadius, person.radius);
    topHeight = Math.max(topHeight, person.height);
  }

  return {
    people,
    links,
    trunkTop: TRUNK_RISE,
    trunkWidth: limbWidth(graph.people.size),
    maxRadius,
    topHeight,
  };
}
