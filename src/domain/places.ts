import type { FamilyGraph } from './graph';
import { PLACE_COORDS, locatePlace, placeKey } from '@/data/geo';
import { parseYear } from './dates';

export interface FamilyPlace {
  name: string;
  lat: number;
  lon: number;
  /** Personnes liées à ce lieu, par naissance, décès ou résidence. */
  personIds: string[];
  /** Année la plus ancienne connue pour ce lieu — sert à ordonner la migration. */
  earliestYear?: number;
  /** Personne née ici en premier, cible naturelle d'un clic sur le lieu. */
  representativeId: string;
}

/**
 * Regroupe toutes les personnes du graphe par lieu de vie (naissance, décès,
 * résidences), pour la carte des lieux. Seuls les lieux dont on connaît les
 * coordonnées apparaissent — un lieu sans coordonnées est ignoré plutôt que
 * de faire échouer la carte.
 */
export function collectFamilyPlaces(graph: FamilyGraph): FamilyPlace[] {
  const byName = new Map<string, FamilyPlace & { repYear?: number }>();

  const touch = (name: string | undefined, personId: string, year: number | undefined, isBirth: boolean): void => {
    if (!name) return;
    const coords = PLACE_COORDS[name];
    if (!coords) return;
    let place = byName.get(name);
    if (!place) {
      place = { name, lat: coords[0], lon: coords[1], personIds: [], representativeId: personId };
      byName.set(name, place);
    }
    if (!place.personIds.includes(personId)) place.personIds.push(personId);
    if (year !== undefined && (place.earliestYear === undefined || year < place.earliestYear)) {
      place.earliestYear = year;
    }
    if (isBirth && year !== undefined && (place.repYear === undefined || year < place.repYear)) {
      place.repYear = year;
      place.representativeId = personId;
    }
  };

  for (const person of graph.people.values()) {
    touch(person.birthPlace, person.id, person.birthYear, true);
    touch(person.deathPlace, person.id, person.deathYear, false);
    for (const residence of person.residences ?? []) touch(residence, person.id, person.birthYear, false);
  }

  return [...byName.values()]
    .map(({ repYear: _repYear, ...place }) => place)
    .sort((a, b) => (a.earliestYear ?? 9999) - (b.earliestYear ?? 9999));
}

/* ── Lieux par périmètre, pour la vue « Carte » ──────────────────────────────
 *
 * `collectFamilyPlaces` ci-dessus sert la vignette de coin : tout le graphe,
 * un point par ville. La vue Carte, elle, doit pouvoir se restreindre à une
 * branche et dire CE QUE chaque personne a fait là — y naître, y vivre, y
 * mourir, s'y marier. D'où ce second relevé, plus détaillé, qui partage le
 * même répertoire de coordonnées.
 */

export type PlaceKind = 'birth' | 'death' | 'residence' | 'union';

export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  birth: 'né ici',
  death: 'décédé ici',
  residence: 'a vécu ici',
  union: 'union ici',
};

export interface PlaceEvent {
  personId: string;
  kind: PlaceKind;
  /** Le lieu tel qu'il est écrit dans la fiche. */
  raw: string;
  year?: number;
}

export interface ScopedPlace {
  key: string;
  label: string;
  lat: number;
  lon: number;
  events: PlaceEvent[];
  people: string[];
  earliestYear?: number;
}

export interface PlaceReport {
  places: ScopedPlace[];
  /**
   * Lieux nommés dans les fiches mais absents du répertoire de coordonnées.
   * Ils sont rendus tels quels plutôt que placés au hasard — « Disparu en mer
   * d'Islande » est un lieu au sens des archives, pas un point sur une carte.
   */
  unlocated: Array<{ key: string; label: string; events: PlaceEvent[]; people: string[] }>;
  /** Personnes du périmètre dont aucune fiche ne mentionne de lieu. */
  withoutPlace: number;
}

/** Tous les lieux nommés dans la fiche d'une personne. */
export function placeEventsOf(graph: FamilyGraph, personId: string): PlaceEvent[] {
  const person = graph.people.get(personId);
  if (!person) return [];

  const events: PlaceEvent[] = [];
  const add = (raw: string | undefined, kind: PlaceKind, year?: number): void => {
    const trimmed = raw?.trim();
    if (trimmed) events.push({ personId, kind, raw: trimmed, year });
  };

  add(person.birthPlace, 'birth', person.birthYear);
  add(person.deathPlace, 'death', person.deathYear);
  for (const residence of person.residences ?? []) add(residence, 'residence');
  for (const link of person.spouseLinks) add(link.place, 'union', parseYear(link.since));

  return events;
}

/** Regroupe par lieu les événements des personnes du périmètre. */
export function collectScopedPlaces(graph: FamilyGraph, scope: Iterable<string>): PlaceReport {
  const located = new Map<string, ScopedPlace>();
  const unknown = new Map<string, { key: string; label: string; events: PlaceEvent[] }>();
  let withoutPlace = 0;

  for (const personId of scope) {
    if (!graph.people.has(personId)) continue;
    const events = placeEventsOf(graph, personId);
    if (events.length === 0) {
      withoutPlace += 1;
      continue;
    }

    for (const event of events) {
      const key = placeKey(event.raw);
      if (!key) continue;
      const entry = locatePlace(event.raw);

      if (entry) {
        const group =
          located.get(key) ??
          ({ key, label: entry.label, lat: entry.lat, lon: entry.lon, events: [], people: [] } as ScopedPlace);
        group.events.push(event);
        if (event.year !== undefined && (group.earliestYear === undefined || event.year < group.earliestYear)) {
          group.earliestYear = event.year;
        }
        located.set(key, group);
      } else {
        const group = unknown.get(key) ?? { key, label: event.raw, events: [] };
        group.events.push(event);
        unknown.set(key, group);
      }
    }
  }

  const distinct = (events: PlaceEvent[]): string[] => [...new Set(events.map((e) => e.personId))];

  const places = [...located.values()].map((p) => ({ ...p, people: distinct(p.events) }));
  places.sort((a, b) => b.people.length - a.people.length || a.label.localeCompare(b.label));

  const unlocated = [...unknown.values()].map((p) => ({ ...p, people: distinct(p.events) }));
  unlocated.sort((a, b) => b.people.length - a.people.length || a.label.localeCompare(b.label));

  return { places, unlocated, withoutPlace };
}

export interface JourneyStep {
  year?: number;
  label: string;
  kind: PlaceKind;
  raw: string;
  located: boolean;
}

/**
 * Le parcours d'une personne : ses lieux, dans l'ordre où ils sont datés.
 *
 * Les étapes sans date ne sont pas rangées au jugé — elles viennent à la
 * suite, signalées comme non datées. Glisser une résidence sans année entre
 * deux dates connues reviendrait à inventer un déplacement.
 */
export function journeyOf(graph: FamilyGraph, personId: string): JourneyStep[] {
  const steps: JourneyStep[] = placeEventsOf(graph, personId).map((event) => {
    const entry = locatePlace(event.raw);
    return {
      year: event.year,
      label: entry?.label ?? event.raw,
      kind: event.kind,
      raw: event.raw,
      located: Boolean(entry),
    };
  });

  const dated = steps.filter((s) => s.year !== undefined).sort((a, b) => a.year! - b.year!);
  return [...dated, ...steps.filter((s) => s.year === undefined)];
}
