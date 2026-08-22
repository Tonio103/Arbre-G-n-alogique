import type { PersonRecord, SpouseLink, UnionStatus } from '@/data/schema';

/**
 * Mutations de l'arbre, toutes pures : chacune reçoit la liste des
 * personnes et en rend une nouvelle, sans toucher à l'ancienne. C'est
 * `useDataset` qui les enchaîne avec `setState` et la sauvegarde — ce
 * fichier ne connaît ni React ni le stockage, seulement la cohérence des
 * données (par exemple : supprimer quelqu'un doit aussi le retirer des
 * `parents` et `spouses` de tous les autres, sans quoi l'arbre pointerait
 * vers un identifiant qui n'existe plus).
 */

let counter = 0;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Identifiant lisible et unique, dérivé du nom plutôt qu'un UUID opaque —
 *  ça reste un identifiant qu'on peut reconnaître en le croisant ailleurs. */
export function generatePersonId(firstName: string, lastName: string, existing: Set<string>): string {
  const base = slugify(`${firstName} ${lastName}`) || 'personne';
  let id = base;
  while (existing.has(id)) {
    counter += 1;
    id = `${base}-${counter}`;
  }
  return id;
}

export interface NewPersonInput {
  firstName: string;
  lastName: string;
  gender?: PersonRecord['gender'];
  birthDate?: string;
}

export function createPerson(input: NewPersonInput, existingIds: Set<string>): PersonRecord {
  return {
    id: generatePersonId(input.firstName, input.lastName, existingIds),
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender,
    birthDate: input.birthDate || undefined,
    parents: [],
    spouses: [],
  };
}

/** Ajoute une personne, ou remplace intégralement sa fiche si son
 *  identifiant existe déjà — c'est ainsi que la modification d'une fiche
 *  existante se distingue de la création d'une nouvelle. */
export function upsertPerson(people: PersonRecord[], person: PersonRecord): PersonRecord[] {
  const index = people.findIndex((p) => p.id === person.id);
  if (index === -1) return [...people, person];
  const next = [...people];
  next[index] = person;
  return next;
}

function spouseId(link: string | SpouseLink): string {
  return typeof link === 'string' ? link : link.id;
}

/** Retire une personne et nettoie toute référence à elle chez les autres —
 *  sans quoi la reconstruction du graphe planterait sur un identifiant
 *  orphelin à la prochaine ouverture. */
export function deletePerson(people: PersonRecord[], id: string): PersonRecord[] {
  return people
    .filter((p) => p.id !== id)
    .map((p) => {
      const parents = p.parents?.filter((pid) => pid !== id);
      const spouses = p.spouses?.filter((s) => spouseId(s) !== id);
      if (parents === p.parents && spouses === p.spouses) return p;
      return { ...p, parents, spouses };
    });
}

/** Ajoute un conjoint : la nouvelle personne, et le lien posé des deux
 *  côtés — c'est ce que `buildFamilyGraph` attend, il ne symétrise pas
 *  lui-même un lien qui n'existerait que d'un côté. */
export function addSpouse(
  people: PersonRecord[],
  personId: string,
  spouse: PersonRecord,
  options?: { status?: UnionStatus; since?: string; place?: string },
): PersonRecord[] {
  const forward: SpouseLink = { id: spouse.id, status: options?.status ?? 'married', since: options?.since, place: options?.place };
  const backward: SpouseLink = { id: personId, status: options?.status ?? 'married', since: options?.since, place: options?.place };
  const withSpouse: PersonRecord = { ...spouse, spouses: [...(spouse.spouses ?? []), backward] };
  return people
    .map((p) => (p.id === personId ? { ...p, spouses: [...(p.spouses ?? []), forward] } : p))
    .concat(withSpouse);
}

/** Ajoute un enfant à une ou deux personnes (un couple, ou un parent seul). */
export function addChild(people: PersonRecord[], parentIds: string[], child: PersonRecord): PersonRecord[] {
  return [...people, { ...child, parents: parentIds }];
}

/** Ajoute un parent à quelqu'un qui n'en a pas encore deux — au-delà, il
 *  faudrait d'abord en retirer un, ce que l'appelant vérifie. */
export function addParent(people: PersonRecord[], childId: string, parent: PersonRecord): PersonRecord[] {
  const withParent = [...people, parent];
  return withParent.map((p) =>
    p.id === childId ? { ...p, parents: [...(p.parents ?? []), parent.id].slice(0, 2) } : p,
  );
}
