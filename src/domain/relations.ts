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

/*
 * ============================================================================
 *
 *  LE CHEMIN DE PARENTÉ
 *
 *  Nommer un lien — « arrière-grand-oncle » — répond à la question mais ne la
 *  démontre pas : on doit croire l'étiquette sur parole. Le chemin, lui, se
 *  vérifie du regard : on remonte du repère jusqu'à l'ancêtre commun, puis on
 *  redescend jusqu'à la personne visée, et chaque pas est une filiation qu'on
 *  peut lire sur le diagramme.
 *
 *  C'est la seule fonction d'une application de généalogie qu'un arbre imprimé
 *  ne rend pas : sur le papier, il faut suivre les traits au doigt.
 *
 * ==========================================================================*/

export interface RelationStep {
  id: string;
  /** Sens du pas depuis le précédent : on remonte, on redescend, ou on épouse. */
  direction: 'up' | 'down' | 'spouse' | 'start';
}

export interface RelationPath {
  steps: RelationStep[];
  /** Ancêtre commun aux deux lignées, quand le lien passe par le sang. */
  meetId?: string;
  /** Toutes les personnes du chemin, pour la mise en évidence. */
  people: Set<string>;
  /** Unions traversées, pour accentuer les traits correspondants. */
  unions: Set<string>;
}

/** Remonte tous les ascendants en gardant, pour chacun, l'enfant d'où l'on vient. */
function climb(
  graph: FamilyGraph,
  id: string,
  maxDepth = 32,
): { distance: Map<string, number>; cameFrom: Map<string, string> } {
  const distance = new Map<string, number>([[id, 0]]);
  const cameFrom = new Map<string, string>();
  const queue = [id];

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const depth = distance.get(current) ?? 0;
    if (depth >= maxDepth) continue;
    for (const parentId of graph.people.get(current)?.parents ?? []) {
      if (distance.has(parentId)) continue;
      distance.set(parentId, depth + 1);
      cameFrom.set(parentId, current);
      queue.push(parentId);
    }
  }

  return { distance, cameFrom };
}

/** Reconstruit la suite d'identifiants de `id` jusqu'à `meet`, en remontant. */
function chainTo(cameFrom: Map<string, string>, meetId: string, id: string): string[] {
  const upward: string[] = [meetId];
  let current = meetId;
  while (current !== id) {
    const next = cameFrom.get(current);
    if (next === undefined) break;
    upward.push(next);
    current = next;
  }
  // `upward` va de l'ancêtre vers la personne : on le retourne.
  return upward.reverse();
}

/**
 * Le chemin de parenté entre deux personnes.
 *
 * Le point de rencontre retenu est celui qui minimise la somme des deux
 * remontées : c'est l'ancêtre commun le plus proche, donc le chemin le plus
 * court — et le seul qui corresponde à ce que dit `describeRelationship`.
 */
export function relationPath(
  graph: FamilyGraph,
  fromId: string,
  toId: string,
): RelationPath | undefined {
  if (fromId === toId) return undefined;
  const from = graph.people.get(fromId);
  if (!from || !graph.people.has(toId)) return undefined;

  const collect = (steps: RelationStep[]): RelationPath => {
    const people = new Set(steps.map((step) => step.id));
    const unions = new Set<string>();
    for (let i = 1; i < steps.length; i += 1) {
      const previous = steps[i - 1];
      const step = steps[i];
      // Le pas franchit une filiation : l'union qui la porte est celle dont
      // l'enfant est issu. C'est elle qu'il faut accentuer sur le diagramme.
      const childId = step.direction === 'down' ? step.id : previous.id;
      const origin = graph.people.get(childId)?.originUnionId;
      if (origin) unions.add(origin);
      if (step.direction === 'spouse') {
        for (const unionId of graph.people.get(step.id)?.unionIds ?? []) {
          if (graph.unions.get(unionId)?.partners.includes(previous.id)) unions.add(unionId);
        }
      }
    }
    return { steps, people, unions };
  };

  // Conjoint : un seul pas, et aucun ancêtre commun à chercher.
  if (from.spouseLinks.some((link) => link.id === toId)) {
    return collect([
      { id: fromId, direction: 'start' },
      { id: toId, direction: 'spouse' },
    ]);
  }

  const up = climb(graph, fromId);
  const down = climb(graph, toId);

  let meetId: string | undefined;
  let best = Infinity;
  for (const [id, distance] of up.distance) {
    const other = down.distance.get(id);
    if (other === undefined) continue;
    if (distance + other < best) {
      best = distance + other;
      meetId = id;
    }
  }

  if (meetId === undefined) return undefined;

  const ascent = chainTo(up.cameFrom, meetId, fromId);
  const descent = chainTo(down.cameFrom, meetId, toId);

  const steps: RelationStep[] = ascent.map((id, index) => ({
    id,
    direction: index === 0 ? 'start' : ('up' as const),
  }));
  // La descente est parcourue à l'envers, et son premier élément — l'ancêtre
  // commun — est déjà le dernier de la montée.
  for (let i = descent.length - 2; i >= 0; i -= 1) {
    steps.push({ id: descent[i], direction: 'down' });
  }

  return { ...collect(steps), meetId };
}
