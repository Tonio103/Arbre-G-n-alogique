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
  /**
   * L'une des deux dates au moins est donnée pour approximative.
   *
   * Gardé pour qui s'en contente ; la frise, elle, lit les deux drapeaux
   * séparés ci-dessous. Un « vers 1810 » au début et un décès daté au jour
   * près ne se notent pas du même côté du trait — les confondre en un seul
   * booléen obligeait à pointiller la vie entière pour une seule incertitude.
   */
  approximate: boolean;
  /** La naissance est approximative : le trait s'amorce en pointillé. */
  approximateBirth: boolean;
  /** Le décès est approximatif : le trait s'achève en pointillé. */
  approximateDeath: boolean;
  /** Pas de date de décès : la barre s'arrête faute de mieux. */
  open: boolean;
  generation: number;
  /** Rangée d'affichage, pour que deux vies ne se recouvrent pas. */
  lane: number;
}

/**
 * UN ENFANT QUI NAÎT SUR LA LIGNE DE VIE DE SON PARENT.
 *
 * C'est ce que ne montre aucune frise généalogique, et c'est pourtant la
 * seule chose qui distingue la chronologie d'une FAMILLE de la chronologie
 * d'une liste de gens : un fil qui descend du trait du parent, à l'année
 * exacte, et qui vient poser le début du trait de l'enfant.
 *
 * N'est émis que si l'année de naissance de l'enfant est connue et si les
 * deux vies ont un trait. Une filiation posée à une date supposée serait une
 * date inventée avec l'apparence d'un fait.
 */
export interface Filiation {
  parentId: string;
  childId: string;
  year: number;
}

/** Une union, portée par les traits des deux conjoints à la même année. */
export interface Alliance {
  aId: string;
  bId: string;
  year: number;
  /** Un divorce ne se note pas comme un mariage. */
  rompue: boolean;
}

/** Une génération et les vies qu'elle range, dans l'ordre des naissances. */
export interface Registre {
  generation: number;
  spans: LifeSpan[];
}

export interface Timeline {
  spans: LifeSpan[];
  /** Personnes du périmètre dont aucune date n'est connue. */
  undated: string[];
  from: number;
  to: number;
  lanes: number;
  /** Les vies groupées par génération, de la plus ancienne à la plus récente. */
  registres: Registre[];
  filiations: Filiation[];
  alliances: Alliance[];
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
      approximateBirth: Boolean(birth?.approximate),
      approximateDeath: Boolean(death?.approximate),
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

  /*
   * LE RANGEMENT PAR GÉNÉRATION.
   *
   * Les vies étaient rangées par année de naissance, toutes générations
   * mêlées. Sur une famille un peu large, la conséquence se voit tout de
   * suite : un grand-oncle né tard tombe entre ses propres petits-neveux, et
   * la frise ne dit plus rien de la marche des générations — le seul mouvement
   * qu'une chronologie familiale ait à montrer.
   *
   * Rangées par génération, puis par naissance à l'intérieur, les traits
   * descendent en escalier à travers les siècles. C'est cette forme-là qu'on
   * vient lire.
   */
  spans.sort(
    (a, b) =>
      a.generation - b.generation ||
      a.from - b.from ||
      a.personId.localeCompare(b.personId),
  );

  const registres: Registre[] = [];
  for (const span of spans) {
    const dernier = registres[registres.length - 1];
    if (dernier && dernier.generation === span.generation) dernier.spans.push(span);
    else registres.push({ generation: span.generation, spans: [span] });
  }

  const traces = new Set(spans.map((span) => span.personId));

  const filiations: Filiation[] = [];
  for (const span of spans) {
    // L'année de naissance, pas `from` : `from` retombe sur l'année du décès
    // quand la naissance est inconnue, et un fil de filiation posé là
    // rattacherait l'enfant à son parent le jour de sa mort à lui.
    const naissance = span.birthYear;
    if (naissance === undefined) continue;
    for (const parentId of graph.people.get(span.personId)?.parents ?? []) {
      if (!traces.has(parentId)) continue;
      filiations.push({ parentId, childId: span.personId, year: naissance });
    }
  }

  const alliances: Alliance[] = [];
  const vues = new Set<string>();
  for (const span of spans) {
    for (const link of graph.people.get(span.personId)?.spouseLinks ?? []) {
      if (!traces.has(link.id)) continue;
      const year = parseYear(link.since);
      if (year === undefined) continue;
      // Une même union est portée par les deux conjoints : on ne la note
      // qu'une fois, du côté du plus petit identifiant.
      const cle = [span.personId, link.id].sort().join('|');
      if (vues.has(cle)) continue;
      vues.add(cle);
      alliances.push({
        aId: span.personId,
        bId: link.id,
        year,
        rompue: link.status === 'divorced',
      });
    }
  }

  const years = spans.flatMap((span) => [span.from, span.to]);
  return {
    spans,
    undated,
    from: years.length > 0 ? Math.min(...years) : 0,
    to: years.length > 0 ? Math.max(...years) : 0,
    lanes: laneEnds.length,
    registres,
    filiations,
    alliances,
  };
}

/** Les personnes de la frise vivantes une année donnée. */
export function livingIn(timeline: Timeline, year: number): LifeSpan[] {
  return timeline.spans.filter((span) => span.from <= year && year <= span.to);
}
