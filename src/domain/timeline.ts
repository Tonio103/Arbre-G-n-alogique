import type { FamilyGraph } from './graph';
import type { Person } from '@/data/schema';
import { parseYear } from './dates';

export type TraceKind = 'birth' | 'union' | 'child' | 'death';

export interface TraceEvent {
  id: string;
  kind: TraceKind;
  year?: number;
  date?: string;
  label: string;
  place?: string;
  /** Personne vers laquelle ce point mène, quand l'événement en implique une autre. */
  personId?: string;
}

/**
 * Le parcours de vie d'une personne, reconstruit à partir de ce que l'on sait
 * déjà d'elle — naissance, unions, naissance de chaque enfant, décès — plutôt
 * que ressaisi à part. Chaque étape qui touche quelqu'un d'autre est
 * navigable ; les autres ne portent qu'un lieu.
 */
export function lifeTrace(graph: FamilyGraph, person: Person): TraceEvent[] {
  const events: TraceEvent[] = [];

  if (person.birthDate || person.birthPlace) {
    events.push({
      id: 'birth',
      kind: 'birth',
      year: person.birthYear,
      date: person.birthDate,
      label: 'Naissance',
      place: person.birthPlace,
    });
  }

  for (const link of person.spouseLinks) {
    const spouse = graph.people.get(link.id);
    if (!spouse) continue;
    const verb =
      link.status === 'divorced'
        ? 'Divorce d’avec'
        : link.status === 'engaged'
          ? 'Fiançailles avec'
          : link.status === 'partner'
            ? 'Union avec'
            : 'Mariage avec';
    events.push({
      id: `union-${link.id}`,
      kind: 'union',
      year: parseYear(link.since),
      date: link.since,
      label: `${verb} ${spouse.firstName}`,
      place: link.place,
      personId: spouse.id,
    });
  }

  for (const childId of person.children) {
    const child = graph.people.get(childId);
    if (!child) continue;
    events.push({
      id: `child-${childId}`,
      kind: 'child',
      year: child.birthYear,
      date: child.birthDate,
      label: `Naissance de ${child.firstName}`,
      place: child.birthPlace,
      personId: child.id,
    });
  }

  if (person.deathDate || person.deathPlace) {
    events.push({
      id: 'death',
      kind: 'death',
      year: person.deathYear,
      date: person.deathDate,
      label: 'Décès',
      place: person.deathPlace,
    });
  }

  return events.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
}
