import type { FamilyGraph } from './graph';
import type { Person } from '@/data/schema';

export type HighlightMode = 'close' | 'lineage';

export interface HighlightSet {
  /** Personnes mises en avant, avec leur rôle vis-à-vis de la sélection. */
  people: Map<string, RelationRole>;
  /** Unions dont le trait doit être accentué. */
  unions: Set<string>;
}

export type RelationRole =
  | 'self'
  | 'spouse'
  | 'parent'
  | 'child'
  | 'sibling'
  | 'ancestor'
  | 'descendant'
  | 'related';

const EMPTY_HIGHLIGHT: HighlightSet = { people: new Map(), unions: new Set() };

/** Ancêtres d'une personne, indexés par distance générationnelle. */
export function ancestorsOf(graph: FamilyGraph, id: string, maxDepth = 32): Map<string, number> {
  const distances = new Map<string, number>([[id, 0]]);
  let frontier = [id];
  let depth = 0;
  while (frontier.length && depth < maxDepth) {
    depth += 1;
    const next: string[] = [];
    for (const current of frontier) {
      for (const parentId of graph.people.get(current)?.parents ?? []) {
        if (distances.has(parentId)) continue;
        distances.set(parentId, depth);
        next.push(parentId);
      }
    }
    frontier = next;
  }
  return distances;
}

export function descendantsOf(graph: FamilyGraph, id: string, maxDepth = 32): Map<string, number> {
  const distances = new Map<string, number>([[id, 0]]);
  let frontier = [id];
  let depth = 0;
  while (frontier.length && depth < maxDepth) {
    depth += 1;
    const next: string[] = [];
    for (const current of frontier) {
      for (const childId of graph.people.get(current)?.children ?? []) {
        if (distances.has(childId)) continue;
        distances.set(childId, depth);
        next.push(childId);
      }
    }
    frontier = next;
  }
  return distances;
}

function collectUnions(graph: FamilyGraph, ids: Iterable<string>, target: Set<string>): void {
  for (const id of ids) {
    const person = graph.people.get(id);
    if (!person) continue;
    for (const unionId of person.unionIds) target.add(unionId);
    if (person.originUnionId) target.add(person.originUnionId);
  }
}

/**
 * Cercle mis en évidence autour de la personne sélectionnée.
 * `close` s'en tient à la famille immédiate ; `lineage` remonte et redescend
 * toute la lignée, ce qui fait ressortir une branche entière dans un grand arbre.
 */
export function computeHighlight(
  graph: FamilyGraph,
  selectedId: string | null,
  mode: HighlightMode,
): HighlightSet {
  if (!selectedId || !graph.people.has(selectedId)) return EMPTY_HIGHLIGHT;

  const person = graph.people.get(selectedId)!;
  const people = new Map<string, RelationRole>();
  people.set(selectedId, 'self');

  const put = (id: string, role: RelationRole): void => {
    if (!graph.people.has(id)) return;
    if (people.has(id)) return;
    people.set(id, role);
  };

  for (const link of person.spouseLinks) put(link.id, 'spouse');
  for (const parentId of person.parents) put(parentId, 'parent');
  for (const childId of person.children) put(childId, 'child');
  for (const siblingId of person.siblings) put(siblingId, 'sibling');
  for (const siblingId of person.halfSiblings) put(siblingId, 'sibling');

  if (mode === 'lineage') {
    for (const [id, distance] of ancestorsOf(graph, selectedId)) {
      if (distance > 0) put(id, 'ancestor');
    }
    for (const [id, distance] of descendantsOf(graph, selectedId)) {
      if (distance > 0) put(id, 'descendant');
    }
    // Les conjoints de la lignée font partie visuellement de la branche.
    for (const id of [...people.keys()]) {
      for (const link of graph.people.get(id)?.spouseLinks ?? []) put(link.id, 'related');
    }
  }

  const unions = new Set<string>();
  collectUnions(graph, people.keys(), unions);

  return { people, unions };
}

function gendered(person: Person | undefined, male: string, female: string, neutral: string): string {
  if (person?.gender === 'm') return male;
  if (person?.gender === 'f') return female;
  return neutral;
}

function ancestorLabel(distance: number, person: Person | undefined): string {
  if (distance === 1) return gendered(person, 'Père', 'Mère', 'Parent');
  if (distance === 2) return gendered(person, 'Grand-père', 'Grand-mère', 'Grand-parent');
  if (distance === 3)
    return gendered(person, 'Arrière-grand-père', 'Arrière-grand-mère', 'Arrière-grand-parent');
  if (distance === 4) return gendered(person, 'Trisaïeul', 'Trisaïeule', 'Trisaïeul·e');
  if (distance === 5) return gendered(person, 'Quadrisaïeul', 'Quadrisaïeule', 'Quadrisaïeul·e');
  return `Ancêtre à la ${distance}ᵉ génération`;
}

function descendantLabel(distance: number, person: Person | undefined): string {
  if (distance === 1) return gendered(person, 'Fils', 'Fille', 'Enfant');
  if (distance === 2) return gendered(person, 'Petit-fils', 'Petite-fille', 'Petit-enfant');
  if (distance === 3)
    return gendered(person, 'Arrière-petit-fils', 'Arrière-petite-fille', 'Arrière-petit-enfant');
  return `Descendant·e à la ${distance}ᵉ génération`;
}

function cousinLabel(degree: number, removal: number, person: Person | undefined): string {
  const base = gendered(person, 'Cousin', 'Cousine', 'Cousin·e');
  const rank =
    degree === 1
      ? `${base} germain${person?.gender === 'f' ? 'e' : ''}`
      : degree === 2
        ? `${base} issu${person?.gender === 'f' ? 'e' : ''} de germain`
        : `${base} au ${degree}ᵉ degré`;
  if (removal === 0) return rank;
  return `${rank} (${removal} génération${removal > 1 ? 's' : ''} d’écart)`;
}

/**
 * Décrit `otherId` du point de vue de `focusId` : « Grand-mère », « Cousine
 * germaine », « Épouse »… Renvoie `undefined` quand aucun lien n'est trouvé.
 */
export function describeRelationship(
  graph: FamilyGraph,
  focusId: string,
  otherId: string,
): string | undefined {
  if (focusId === otherId) return undefined;
  const focus = graph.people.get(focusId);
  const other = graph.people.get(otherId);
  if (!focus || !other) return undefined;

  const spouseLink = focus.spouseLinks.find((link) => link.id === otherId);
  if (spouseLink) {
    if (spouseLink.status === 'divorced') {
      return gendered(other, 'Ex-époux', 'Ex-épouse', 'Ancien·ne conjoint·e');
    }
    if (spouseLink.status === 'partner' || spouseLink.status === 'engaged') {
      return gendered(other, 'Compagnon', 'Compagne', 'Conjoint·e');
    }
    return gendered(other, 'Époux', 'Épouse', 'Conjoint·e');
  }

  const focusAncestors = ancestorsOf(graph, focusId);
  const otherAncestors = ancestorsOf(graph, otherId);

  let bestFocus = Infinity;
  let bestOther = Infinity;
  for (const [id, distance] of focusAncestors) {
    const otherDistance = otherAncestors.get(id);
    if (otherDistance === undefined) continue;
    if (distance + otherDistance < bestFocus + bestOther) {
      bestFocus = distance;
      bestOther = otherDistance;
    }
  }

  if (Number.isFinite(bestFocus) && Number.isFinite(bestOther)) {
    if (bestOther === 0) return ancestorLabel(bestFocus, other);
    if (bestFocus === 0) return descendantLabel(bestOther, other);
    if (bestFocus === 1 && bestOther === 1) {
      const half = focus.halfSiblings.includes(otherId);
      const base = gendered(other, 'Frère', 'Sœur', 'Frère ou sœur');
      return half ? `Demi-${base.toLowerCase()}` : base;
    }
    if (bestFocus === 1) {
      const distance = bestOther - 1;
      if (distance === 1) return gendered(other, 'Neveu', 'Nièce', 'Neveu ou nièce');
      if (distance === 2) return gendered(other, 'Petit-neveu', 'Petite-nièce', 'Petit-neveu');
      return `Descendant·e d’un frère ou d’une sœur`;
    }
    if (bestOther === 1) {
      const distance = bestFocus - 1;
      if (distance === 1) return gendered(other, 'Oncle', 'Tante', 'Oncle ou tante');
      if (distance === 2) return gendered(other, 'Grand-oncle', 'Grand-tante', 'Grand-oncle');
      return `Ascendant·e collatéral·e`;
    }
    return cousinLabel(Math.min(bestFocus, bestOther) - 1, Math.abs(bestFocus - bestOther), other);
  }

  // Aucun sang commun : on tente la belle-famille au premier degré.
  for (const link of focus.spouseLinks) {
    const spouse = graph.people.get(link.id);
    if (!spouse) continue;
    if (spouse.parents.includes(otherId)) {
      return gendered(other, 'Beau-père', 'Belle-mère', 'Beau-parent');
    }
    if (spouse.siblings.includes(otherId)) {
      return gendered(other, 'Beau-frère', 'Belle-sœur', 'Beau-frère ou belle-sœur');
    }
  }
  for (const childId of focus.children) {
    const child = graph.people.get(childId);
    if (child?.spouseLinks.some((link) => link.id === otherId)) {
      return gendered(other, 'Gendre', 'Belle-fille', 'Bel-enfant');
    }
  }
  for (const siblingId of focus.siblings) {
    const sibling = graph.people.get(siblingId);
    if (sibling?.spouseLinks.some((link) => link.id === otherId)) {
      return gendered(other, 'Beau-frère', 'Belle-sœur', 'Beau-frère ou belle-sœur');
    }
  }

  return undefined;
}
