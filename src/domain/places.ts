import type { FamilyGraph } from './graph';
import { PLACE_COORDS } from '@/data/geo';

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
