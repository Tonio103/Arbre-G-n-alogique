import type {
  BranchAnchor,
  FamilyDataset,
  Person,
  PersonRecord,
  SpouseLink,
  Union,
  UnionStatus,
} from '@/data/schema';
import { normalizeText } from './text';
import { parseYear, computeAgeAtDeath } from './dates';

export interface FamilyGraph {
  title: string;
  subtitle?: string;
  rootId: string;
  people: Map<string, Person>;
  /** Ordre stable, trié par génération puis par année de naissance. */
  order: string[];
  unions: Map<string, Union>;
  /** Branches nommées, pour se repérer en vue éloignée. */
  branches: BranchAnchor[];
  /** Générations effectivement peuplées, de la plus ancienne à la plus récente. */
  generations: number[];
  /** Anomalies détectées dans les données (référence inconnue, cycle…). */
  warnings: string[];
}

/**
 * Exporté pour prédire l'identifiant d'une union avant même la reconstruction
 * du graphe — voir `growingUnionId` dans `App.tsx`, qui anime le trait d'une
 * union tout juste créée dès l'instant où on sait qui la compose.
 *
 * Accepte un nombre quelconque de parents : une adoption en donne trois ou
 * quatre à un même enfant. La version précédente n'en prenait que deux et
 * laissait tomber les suivants — deux fratries adoptives partageant leurs
 * deux premiers parents se retrouvaient alors dans la même union.
 */
export const unionKey = (...ids: string[]): string => `u:${[...ids].sort().join('+')}`;

const toSpouseLink = (entry: string | SpouseLink): SpouseLink =>
  typeof entry === 'string' ? { id: entry, status: 'married' } : { ...entry };

/** Le statut le plus informatif l'emporte quand les deux conjoints se décrivent différemment. */
const mergeStatus = (a: UnionStatus | undefined, b: UnionStatus | undefined): UnionStatus => {
  const rank: Record<UnionStatus, number> = {
    unknown: 0,
    engaged: 1,
    partner: 2,
    married: 3,
    widowed: 4,
    divorced: 5,
  };
  const left = a ?? 'unknown';
  const right = b ?? 'unknown';
  return rank[left] >= rank[right] ? left : right;
};

function buildInitials(firstName: string, lastName: string): string {
  const a = [...firstName.trim()][0] ?? '';
  const b = [...lastName.trim()][0] ?? '';
  return (a + b).toUpperCase();
}

/**
 * Assigne une profondeur à chaque personne.
 *
 * Deux contraintes se disputent : un enfant est une génération sous ses parents,
 * et deux conjoints doivent partager la même ligne pour être dessinés côte à côte.
 * On relaxe donc itérativement les deux règles jusqu'à stabilisation, en poussant
 * toujours vers le bas — ce qui converge et laisse les mariages alignés même quand
 * les deux époux viennent de branches de profondeurs différentes.
 */
function assignGenerations(
  records: Map<string, PersonRecord>,
  spouseMap: Map<string, Set<string>>,
  warnings: string[],
): Map<string, number> {
  const generation = new Map<string, number>();
  for (const id of records.keys()) generation.set(id, 0);

  const MAX_PASSES = 60;
  let pass = 0;
  let changed = true;

  while (changed && pass < MAX_PASSES) {
    changed = false;
    pass += 1;

    for (const [id, record] of records) {
      const parents = record.parents ?? [];
      let target = generation.get(id) ?? 0;
      for (const parentId of parents) {
        if (!records.has(parentId)) continue;
        const parentGen = generation.get(parentId) ?? 0;
        if (parentGen + 1 > target) target = parentGen + 1;
      }
      if (target !== generation.get(id)) {
        generation.set(id, target);
        changed = true;
      }
    }

    for (const [id, partners] of spouseMap) {
      if (!records.has(id)) continue;
      let target = generation.get(id) ?? 0;
      for (const partnerId of partners) {
        if (!records.has(partnerId)) continue;
        const partnerGen = generation.get(partnerId) ?? 0;
        if (partnerGen > target) target = partnerGen;
      }
      if (target !== generation.get(id)) {
        generation.set(id, target);
        changed = true;
      }
    }
  }

  if (pass >= MAX_PASSES) {
    warnings.push(
      'Les générations n’ont pas convergé : il existe probablement une boucle de filiation dans les données.',
    );
  }

  // Ramener la génération minimale à 0.
  let min = Number.POSITIVE_INFINITY;
  for (const value of generation.values()) min = Math.min(min, value);
  if (min !== 0 && Number.isFinite(min)) {
    for (const [id, value] of generation) generation.set(id, value - min);
  }

  return generation;
}

export function buildFamilyGraph(dataset: FamilyDataset): FamilyGraph {
  const warnings: string[] = [];
  const records = new Map<string, PersonRecord>();

  for (const record of dataset.people) {
    if (records.has(record.id)) {
      warnings.push(`Identifiant en double ignoré : « ${record.id} ».`);
      continue;
    }
    records.set(record.id, record);
  }

  // --- Filiation : nettoyage des références et dérivation des enfants ---
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const id of records.keys()) childrenOf.set(id, []);

  for (const [id, record] of records) {
    const parents: string[] = [];
    for (const parentId of record.parents ?? []) {
      if (parentId === id) {
        warnings.push(`« ${id} » est déclaré comme son propre parent.`);
        continue;
      }
      if (!records.has(parentId)) {
        warnings.push(`Parent inconnu « ${parentId} » référencé par « ${id} ».`);
        continue;
      }
      if (parents.includes(parentId)) continue;
      parents.push(parentId);
    }
    /*
     * Aucun plafond à deux parents.
     *
     * Cette normalisation en gardait autrefois les deux premiers et signalait
     * les autres comme une anomalie. C'en était une du point de vue de la
     * biologie, pas de celui d'une famille : une adoption, une reconnaissance
     * ou une famille recomposée en donnent trois ou quatre, et les inscrire
     * tous vaut mieux que d'avoir à choisir lesquels comptent.
     */
    parentsOf.set(id, parents);
    for (const parentId of parents) childrenOf.get(parentId)!.push(id);
  }

  // --- Conjoints : symétrisation des liens ---
  const spouseLinks = new Map<string, Map<string, SpouseLink>>();
  for (const id of records.keys()) spouseLinks.set(id, new Map());

  for (const [id, record] of records) {
    for (const entry of record.spouses ?? []) {
      const link = toSpouseLink(entry);
      if (link.id === id) {
        warnings.push(`« ${id} » est déclaré comme son propre conjoint.`);
        continue;
      }
      if (!records.has(link.id)) {
        warnings.push(`Conjoint inconnu « ${link.id} » référencé par « ${id} ».`);
        continue;
      }
      const mine = spouseLinks.get(id)!;
      const theirs = spouseLinks.get(link.id)!;
      const existing = mine.get(link.id);
      const merged: SpouseLink = {
        id: link.id,
        status: mergeStatus(existing?.status, link.status),
        since: link.since ?? existing?.since,
        until: link.until ?? existing?.until,
        place: link.place ?? existing?.place,
      };
      mine.set(link.id, merged);
      theirs.set(id, { ...merged, id });
    }
  }

  const spouseSets = new Map<string, Set<string>>();
  for (const [id, links] of spouseLinks) spouseSets.set(id, new Set(links.keys()));

  const generation = assignGenerations(records, spouseSets, warnings);

  // --- Personnes normalisées ---
  const people = new Map<string, Person>();

  for (const [id, record] of records) {
    const parents = parentsOf.get(id) ?? [];
    const links = [...spouseLinks.get(id)!.values()];
    const birthYear = parseYear(record.birthDate);
    const deathYear = parseYear(record.deathDate);
    const displayName = `${record.firstName} ${record.lastName}`.trim();
    const searchable = [
      record.firstName,
      record.middleNames,
      record.lastName,
      record.maidenName,
      record.nickname,
      record.profession,
      record.birthPlace,
    ]
      .filter(Boolean)
      .join(' ');

    people.set(id, {
      ...record,
      parents,
      children: childrenOf.get(id) ?? [],
      siblings: [],
      halfSiblings: [],
      spouseLinks: links,
      unionIds: [],
      generation: generation.get(id) ?? 0,
      displayName,
      birthName:
        record.maidenName && record.maidenName !== record.lastName
          ? `${record.firstName} ${record.maidenName}`
          : undefined,
      initials: buildInitials(record.firstName, record.lastName),
      birthYear,
      deathYear,
      living: !record.deathDate,
      ageAtDeath: computeAgeAtDeath(record.birthDate, record.deathDate),
      nameKey: normalizeText(displayName),
      searchKey: normalizeText(searchable),
    });
  }

  const birthRank = (id: string): number => people.get(id)?.birthYear ?? Number.MAX_SAFE_INTEGER;
  const byBirth = (a: string, b: string): number => {
    const delta = birthRank(a) - birthRank(b);
    if (delta !== 0) return delta;
    return a.localeCompare(b);
  };

  // --- Fratries ---
  for (const [id, person] of people) {
    if (person.parents.length === 0) continue;
    const full = new Set<string>();
    const half = new Set<string>();
    const parentSet = new Set(person.parents);

    for (const parentId of person.parents) {
      for (const siblingId of childrenOf.get(parentId) ?? []) {
        if (siblingId === id) continue;
        const siblingParents = parentsOf.get(siblingId) ?? [];
        const shared = siblingParents.filter((p) => parentSet.has(p)).length;
        // Fratrie pleine si les deux enfants ont exactement les mêmes parents connus.
        if (shared >= 2 || (shared === 1 && siblingParents.length === 1 && parentSet.size === 1)) {
          full.add(siblingId);
          half.delete(siblingId);
        } else if (!full.has(siblingId)) {
          half.add(siblingId);
        }
      }
    }
    person.siblings = [...full].sort(byBirth);
    person.halfSiblings = [...half].sort(byBirth);
  }

  // --- Unions ---
  const unions = new Map<string, Union>();

  const ensureUnion = (partners: string[]): Union => {
    const sorted = [...partners].sort();
    const key = unionKey(...sorted);
    let union = unions.get(key);
    if (!union) {
      union = { id: key, partners: sorted, children: [], status: 'unknown' };
      unions.set(key, union);
    }
    return union;
  };

  // Une union existe dès qu'un couple est déclaré, même sans descendance.
  for (const [id, links] of spouseLinks) {
    for (const link of links.values()) {
      if (id > link.id) continue; // une seule fois par paire
      const union = ensureUnion([id, link.id]);
      union.status = mergeStatus(union.status, link.status);
      union.since = union.since ?? link.since;
      union.until = union.until ?? link.until;
      union.place = union.place ?? link.place;
    }
  }

  // Puis chaque enfant rattache ses parents à une union.
  for (const [id, person] of people) {
    if (person.parents.length === 0) continue;
    const union = ensureUnion(person.parents);
    union.children.push(id);
  }

  for (const union of unions.values()) {
    union.children.sort(byBirth);
    for (const partnerId of union.partners) {
      people.get(partnerId)?.unionIds.push(union.id);
    }
    for (const childId of union.children) {
      const child = people.get(childId);
      if (child) child.originUnionId = union.id;
    }
  }

  // Unions d'une personne ordonnées chronologiquement, pour un placement stable.
  for (const person of people.values()) {
    person.unionIds.sort((a, b) => {
      const ua = unions.get(a);
      const ub = unions.get(b);
      const ya = parseYear(ua?.since) ?? birthRank(ua?.children[0] ?? '');
      const yb = parseYear(ub?.since) ?? birthRank(ub?.children[0] ?? '');
      if (ya !== yb) return ya - yb;
      return a.localeCompare(b);
    });
    person.children.sort(byBirth);
  }

  const order = [...people.keys()].sort((a, b) => {
    const pa = people.get(a)!;
    const pb = people.get(b)!;
    if (pa.generation !== pb.generation) return pa.generation - pb.generation;
    return byBirth(a, b);
  });

  const generations = [...new Set(order.map((id) => people.get(id)!.generation))].sort(
    (a, b) => a - b,
  );

  const rootId = people.has(dataset.rootId) ? dataset.rootId : (order[0] ?? '');
  if (!people.has(dataset.rootId)) {
    warnings.push(`Personne racine « ${dataset.rootId} » introuvable ; repli sur « ${rootId} ».`);
  }

  return {
    title: dataset.title,
    subtitle: dataset.subtitle,
    rootId,
    people,
    order,
    unions,
    branches: (dataset.branches ?? []).filter((branch) => people.has(branch.anchorId)),
    generations,
    warnings,
  };
}
