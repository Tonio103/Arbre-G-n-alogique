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

function spouseIdOf(link: string | SpouseLink): string {
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
      const spouses = p.spouses?.filter((s) => spouseIdOf(s) !== id);
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

/** Ajoute un parent. Le nombre n'est pas plafonné : une adoption ou une
 *  reconnaissance en donne trois ou quatre (voir `schema.ts`). */
export function addParent(people: PersonRecord[], childId: string, parent: PersonRecord): PersonRecord[] {
  const withParent = [...people, parent];
  return withParent.map((p) =>
    p.id === childId ? { ...p, parents: [...(p.parents ?? []), parent.id] } : p,
  );
}

/*
 * Relier plutôt que créer.
 *
 * `addParent`/`addSpouse`/`addChild` créent toujours une personne neuve — le
 * cas courant, une naissance ou une union qu'on découvre. Mais deux enfants
 * qui partagent un second parent, ou un couple dont l'un des deux existe déjà
 * ailleurs dans l'arbre, ont besoin de l'inverse : relier une fiche qui
 * existe déjà, sans en dupliquer le contenu sous un nouvel identifiant.
 */

/** Relie un parent déjà existant, sans créer de nouvelle fiche. Un lien déjà
 *  posé n'est pas dupliqué. */
export function linkParent(people: PersonRecord[], childId: string, parentId: string): PersonRecord[] {
  return people.map((p) => {
    if (p.id !== childId) return p;
    const parents = (p.parents ?? []).filter((id) => id !== parentId);
    return { ...p, parents: [...parents, parentId] };
  });
}

/** Relie un conjoint déjà existant, des deux côtés à la fois — voir `addSpouse`. */
export function linkSpouse(
  people: PersonRecord[],
  personId: string,
  otherId: string,
  options?: { status?: UnionStatus; since?: string; place?: string },
): PersonRecord[] {
  const forward: SpouseLink = { id: otherId, status: options?.status ?? 'married', since: options?.since, place: options?.place };
  const backward: SpouseLink = { id: personId, status: options?.status ?? 'married', since: options?.since, place: options?.place };
  return people.map((p) => {
    if (p.id === personId) return { ...p, spouses: [...(p.spouses ?? []), forward] };
    if (p.id === otherId) return { ...p, spouses: [...(p.spouses ?? []), backward] };
    return p;
  });
}

/** Relie un enfant déjà existant à ses parents — voir `addChild`. */
export function linkChild(people: PersonRecord[], parentIds: string[], childId: string): PersonRecord[] {
  return people.map((p) => (p.id === childId ? { ...p, parents: [...parentIds] } : p));
}

/*
 * Défaire un lien, sans supprimer personne.
 *
 * Retirer une union ou une filiation n'est pas la même chose que supprimer
 * une fiche : la personne reste dans l'arbre avec tout ce qu'on sait d'elle,
 * seul le lien disparaît. C'est ce qu'il faut pour corriger une erreur de
 * saisie, un remariage mal noté ou une filiation qui s'avère fausse.
 */

/** Détache un parent de son enfant. */
export function detachParent(people: PersonRecord[], childId: string, parentId: string): PersonRecord[] {
  return people.map((p) =>
    p.id === childId ? { ...p, parents: (p.parents ?? []).filter((id) => id !== parentId) } : p,
  );
}

/** Défait une union, des deux côtés à la fois. */
export function detachSpouse(people: PersonRecord[], personId: string, spouseId: string): PersonRecord[] {
  return people.map((p) => {
    if (p.id !== personId && p.id !== spouseId) return p;
    const other = p.id === personId ? spouseId : personId;
    return { ...p, spouses: (p.spouses ?? []).filter((s) => spouseIdOf(s) !== other) };
  });
}

/** Détache un enfant de ce parent-ci, en lui laissant ses autres parents. */
export function detachChild(people: PersonRecord[], parentId: string, childId: string): PersonRecord[] {
  return detachParent(people, childId, parentId);
}
