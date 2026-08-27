import type { FamilyGraph } from './graph';
import type { Person } from '@/data/schema';
import { parseDate, parseYear } from './dates';

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

/* ── La frise, pour la vue « Chronologie » ───────────────────────────────────
 *
 * `lifeTrace` ci-dessus raconte UNE vie, dans le panneau de détails. Ce qui
 * suit range plusieurs vies côte à côte sur un même axe des années, pour voir
 * d'un coup d'œil qui a vécu en même temps que qui.
 *
 * Trois cas, tenus séparés parce qu'ils ne se lisent pas pareil :
 *   · année connue        → la barre commence à l'année exacte ;
 *   · année approximative → même position, mais signalée comme telle
 *     (« vers 1887 » est une position, pas une certitude) ;
 *   · aucune date         → pas de barre du tout. La personne est listée à
 *     part. On n'invente pas une position pour faire joli.
 */

export interface LifeSpan {
  personId: string;
  from: number;
  to: number;
  birthYear?: number;
  deathYear?: number;
  /** L'une des deux dates au moins est donnée pour approximative. */
  approximate: boolean;
  /** Pas de date de décès : la barre s'arrête faute de mieux. */
  open: boolean;
  generation: number;
  /** Rangée d'affichage, pour que deux vies ne se recouvrent pas. */
  lane: number;
}

export interface Timeline {
  spans: LifeSpan[];
  /** Personnes du périmètre dont aucune date n'est connue. */
  undated: string[];
  from: number;
  to: number;
  lanes: number;
}

/**
 * Jusqu'où tirer la barre d'une vie sans date de décès.
 *
 * On ne suppose aucune durée de vie : on s'arrête à la dernière année où la
 * personne est attestée par les données — la naissance de son dernier enfant,
 * à défaut la sienne. Au-delà, on ne sait rien, et la barre est marquée
 * ouverte pour que ça se voie.
 */
function lastAttested(graph: FamilyGraph, personId: string, birthYear: number): number {
  let last = birthYear;
  for (const childId of graph.people.get(personId)?.children ?? []) {
    const year = graph.people.get(childId)?.birthYear;
    if (year && year > last) last = year;
  }
  return last;
}

/** Construit la frise des personnes du périmètre. */
export function buildTimeline(graph: FamilyGraph, scope: Iterable<string>): Timeline {
  const spans: LifeSpan[] = [];
  const undated: string[] = [];

  for (const personId of scope) {
    const person = graph.people.get(personId);
    if (!person) continue;

    const birth = parseDate(person.birthDate);
    const death = parseDate(person.deathDate);

    if (!birth && !death) {
      undated.push(personId);
      continue;
    }

    // Sans naissance mais avec un décès, la barre se réduit à l'année du
    // décès : on ne recule pas d'une durée de vie supposée.
    const from = birth?.year ?? death!.year;
    const to = death?.year ?? lastAttested(graph, personId, from);

    spans.push({
      personId,
      from,
      to: Math.max(to, from),
      birthYear: birth?.year,
      deathYear: death?.year,
      approximate: Boolean(birth?.approximate || death?.approximate),
      open: !death,
      generation: person.generation,
      lane: 0,
    });
  }

  spans.sort((a, b) => a.from - b.from || a.to - b.to || a.personId.localeCompare(b.personId));

  // Un rangement d'agenda : chaque barre reprend la première rangée libérée
  // avant elle, et n'en ouvre une nouvelle qu'à défaut.
  const laneEnds: number[] = [];
  for (const span of spans) {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= span.from) lane += 1;
    laneEnds[lane] = span.to;
    span.lane = lane;
  }

  const years = spans.flatMap((span) => [span.from, span.to]);
  return {
    spans,
    undated,
    from: years.length > 0 ? Math.min(...years) : 0,
    to: years.length > 0 ? Math.max(...years) : 0,
    lanes: laneEnds.length,
  };
}

/** Les personnes de la frise vivantes une année donnée. */
export function livingIn(timeline: Timeline, year: number): LifeSpan[] {
  return timeline.spans.filter((span) => span.from <= year && year <= span.to);
}
