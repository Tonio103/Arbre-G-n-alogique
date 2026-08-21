import type { BranchAnchor, FamilyDataset, PersonRecord } from './schema';
import { CORE_PEOPLE, LINEAGE_SEEDS } from './core-family';
import { MA_FAMILLE } from './ma-famille';
import { expandLineage, linkBranches, type GeneratedLineage } from './generator';
import { parseYear } from '@/domain/dates';

/**
 * Assemble le jeu de données complet : le noyau saisi à la main, puis les
 * branches collatérales engendrées à partir des graines déclarées.
 *
 * Pour travailler sur un arbre plus grand ou plus petit, ajustez les `budget`
 * des graines dans `core-family.ts` — rien d'autre à modifier.
 */
function assemblePeople(): PersonRecord[] {
  const index = new Map<string, PersonRecord>();
  for (const person of CORE_PEOPLE) index.set(person.id, person);

  const lineages: GeneratedLineage[] = [];

  LINEAGE_SEEDS.forEach((seed, position) => {
    const founder = index.get(seed.founderId);
    const founderBirthYear = parseYear(founder?.birthDate) ?? 1880;
    const lineage = expandLineage(seed, founderBirthYear, 0x1000 + position * 7919);
    for (const person of lineage.people) {
      if (index.has(person.id)) continue;
      index.set(person.id, person);
    }
    lineages.push(lineage);
  });

  linkBranches(lineages, index);

  return [...index.values()];
}

/**
 * Branches nommées, pour se repérer quand on prend de la hauteur.
 * Chaque graine donne son nom à l'espace occupé par sa descendance ; s'y
 * ajoutent les deux lignées fondatrices et la lignée directe.
 */
const BRANCHES: BranchAnchor[] = [
  ...LINEAGE_SEEDS.map((seed) => ({ label: seed.label, anchorId: seed.founderId })),
  { label: 'Souche Beaumont — la Sorgue', anchorId: 'auguste-beaumont-1866' },
  { label: 'Souche Ferrand — Beaune', anchorId: 'eugene-ferrand-1864' },
  { label: 'Lignée directe — Avignon', anchorId: 'roger-beaumont-1921' },
];

/** L'arbre de démonstration : la famille fictive des Beaumont. */
const DEMONSTRATION: FamilyDataset = {
  title: 'Beaumont — Ferrand',
  subtitle: 'Sept générations, du moulin de la Sorgue à aujourd’hui',
  rootId: 'camille-beaumont-1985',
  people: assemblePeople(),
  branches: BRANCHES,
};

/**
 * Le jeu de données affiché.
 *
 * Votre famille si vous en avez déclaré une dans `ma-famille.ts`, la
 * démonstration sinon. C'est le seul endroit où les deux se rencontrent :
 * l'interface, elle, ne connaît que `FAMILY_DATASET`.
 */
export const FAMILY_DATASET: FamilyDataset =
  MA_FAMILLE && MA_FAMILLE.people.length > 0 ? MA_FAMILLE : DEMONSTRATION;
