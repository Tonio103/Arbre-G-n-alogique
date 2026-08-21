import type { PersonRecord } from './schema';
import type { LineageSeed } from './core-family';
import {
  ANECDOTES,
  EDUCATION,
  GIVEN_NAMES,
  INTERESTS,
  MEMORY_FRAGMENTS,
  PROFESSIONS,
  REGIONS,
  SURNAMES,
  pickEra,
} from './vocabulary';

/** Année après laquelle on ne fait plus naître personne. */
const LAST_BIRTH_YEAR = 2022;
const CURRENT_YEAR = 2026;

type Rng = () => number;

/** Générateur pseudo-aléatoire déterministe : le même arbre à chaque chargement. */
function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, list: T[]): T => list[Math.floor(rng() * list.length) % list.length];

function pickMany<T>(rng: Rng, list: T[], count: number): T[] {
  const result: T[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count * 3 && result.length < count; i += 1) {
    const index = Math.floor(rng() * list.length) % list.length;
    if (used.has(index)) continue;
    used.add(index);
    result.push(list[index]);
  }
  return result;
}

const between = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Nombre d'enfants d'un couple, selon l'époque : les familles rétrécissent. */
function childCount(rng: Rng, birthYear: number): number {
  const roll = rng();
  if (birthYear < 1900) return roll < 0.12 ? 2 : roll < 0.45 ? 3 : roll < 0.78 ? 4 : between(rng, 5, 7);
  if (birthYear < 1935) return roll < 0.16 ? 1 : roll < 0.5 ? 2 : roll < 0.82 ? 3 : between(rng, 4, 5);
  if (birthYear < 1970) return roll < 0.12 ? 1 : roll < 0.55 ? 2 : roll < 0.88 ? 3 : 4;
  if (birthYear < 1995) return roll < 0.2 ? 1 : roll < 0.72 ? 2 : 3;
  return roll < 0.42 ? 1 : 2;
}

/** Durée de vie plausible ; l'espérance progresse au fil des générations. */
function lifespan(rng: Rng, birthYear: number): number {
  const base = birthYear < 1900 ? 62 : birthYear < 1930 ? 70 : birthYear < 1960 ? 78 : 84;
  const spread = between(rng, -16, 14);
  return Math.max(24, base + spread);
}

function professionFor(rng: Rng, birthYear: number, gender: 'f' | 'm'): string | undefined {
  if (birthYear > CURRENT_YEAR - 22) return undefined;
  const era = pickEra(PROFESSIONS, birthYear + 25);
  return pick(rng, gender === 'f' ? era.female : era.male);
}

function givenName(rng: Rng, birthYear: number, gender: 'f' | 'm'): string {
  const era = pickEra(GIVEN_NAMES, birthYear);
  return pick(rng, gender === 'f' ? era.female : era.male);
}

function placeFor(rng: Rng, regionKey: string, driftKey: string | undefined, birthYear: number): string {
  // À partir des années 1950, une partie de chaque branche part vers la ville.
  const driftChance = birthYear < 1945 ? 0 : birthYear < 1975 ? 0.28 : 0.45;
  const key = driftKey && rng() < driftChance ? driftKey : regionKey;
  const region = REGIONS[key] ?? REGIONS.provence;
  return pick(rng, region.places);
}

interface BiographyContext {
  firstName: string;
  profession?: string;
  place: string;
  birthYear: number;
  branchLabel: string;
}

function biographyFor(rng: Rng, context: BiographyContext): string | undefined {
  if (rng() < 0.42) return undefined;
  const { profession, place, birthYear } = context;
  const options: string[] = [];
  if (profession) {
    options.push(
      `${profession} à ${place}. A passé l’essentiel de sa vie dans la région.`,
      `Installé${rng() < 0.5 ? 'e' : ''} à ${place} vers ${birthYear + between(rng, 22, 32)}, ${profession.toLowerCase()} pendant plus de trente ans.`,
      `A exercé comme ${profession.toLowerCase()} à ${place}, après un début de carrière ailleurs.`,
    );
  }
  options.push(
    `Né${rng() < 0.5 ? 'e' : ''} à ${place}, resté${rng() < 0.5 ? 'e' : ''} proche de sa famille toute sa vie.`,
    `A grandi à ${place}, dans la maison familiale.`,
  );
  return pick(rng, options);
}

interface QueueEntry {
  parentIds: string[];
  parentBirthYear: number;
  /**
   * Année où le premier des deux parents disparaît.
   *
   * Une fratrie s'échelonne sur vingt ans : sans cette borne, des enfants
   * naissaient encore plusieurs années après la mort de leur mère.
   */
  parentDeathYear: number;
  /** Nom transmis aux enfants. */
  lastName: string;
  depth: number;
}

export interface GeneratedLineage {
  people: PersonRecord[];
  /** Personnes restées célibataires : candidates aux mariages entre branches. */
  singles: { id: string; birthYear: number; gender: 'f' | 'm'; branch: string }[];
}

interface PersonInput {
  rng: Rng;
  id: string;
  firstName: string;
  lastName: string;
  gender: 'f' | 'm';
  birthYear: number;
  regionKey: string;
  driftKey?: string;
  branchLabel: string;
  parents?: string[];
  maidenName?: string;
  /**
   * Âge minimal atteint par la personne.
   *
   * La mortalité est tirée au sort pour tout le monde, ce qui produisait des
   * conjoints morts en bas âge : quelqu'un né et enterré la même année se
   * retrouvait marié quarante ans plus tard, parce que l'époux était fabriqué
   * sans qu'on regarde s'il avait vécu jusqu'au mariage. Une personne qu'on
   * s'apprête à marier reçoit donc un plancher.
   */
  minAge?: number;
}

function makePerson(input: PersonInput): PersonRecord {
  const { rng, birthYear, gender } = input;
  const birthPlace = placeFor(rng, input.regionKey, input.driftKey, birthYear);
  const profession = professionFor(rng, birthYear, gender);

  // Mortalité : forte avant 1920, faible ensuite ; personne ne dépasse l'année courante.
  const infantDeath = input.minAge === undefined && birthYear < 1925 && rng() < 0.05;
  const span = infantDeath
    ? between(rng, 0, 4)
    : Math.max(lifespan(rng, birthYear), (input.minAge ?? 0) + between(rng, 1, 14));
  const deathYear = birthYear + span;
  const isDead = deathYear <= CURRENT_YEAR;

  const record: PersonRecord = {
    id: input.id,
    firstName: input.firstName,
    lastName: input.lastName,
    gender,
    birthDate: `${birthYear}-${String(between(rng, 1, 12)).padStart(2, '0')}-${String(between(rng, 1, 28)).padStart(2, '0')}`,
    birthPlace,
    parents: input.parents ?? [],
  };

  if (input.maidenName) record.maidenName = input.maidenName;

  if (isDead) {
    record.deathDate = `${deathYear}-${String(between(rng, 1, 12)).padStart(2, '0')}-${String(between(rng, 1, 28)).padStart(2, '0')}`;
    record.deathPlace = rng() < 0.62 ? birthPlace : placeFor(rng, input.regionKey, input.driftKey, birthYear + 40);
  }

  if (infantDeath) {
    record.headline = 'Mort en bas âge';
    record.custom = { 'Branche familiale': input.branchLabel };
    return record;
  }

  if (profession) {
    record.profession = profession;
    record.headline = `${profession}, ${birthPlace.replace(/^Paris .*/, 'Paris')}`;
  } else if (birthYear > CURRENT_YEAR - 20) {
    record.headline = birthYear > CURRENT_YEAR - 7 ? 'Petite enfance' : 'Scolarité en cours';
  }

  const interestCount = rng() < 0.25 ? 1 : rng() < 0.75 ? 2 : 3;
  record.interests = pickMany(rng, INTERESTS, interestCount);

  if (rng() < 0.34) record.anecdotes = [pick(rng, ANECDOTES)];
  if (rng() < 0.16) record.memories = [pick(rng, MEMORY_FRAGMENTS)];
  if (rng() < 0.4 && birthYear < CURRENT_YEAR - 20) record.education = pick(rng, EDUCATION);

  const residences = [birthPlace];
  if (rng() < 0.45) {
    const other = placeFor(rng, input.regionKey, input.driftKey, birthYear + 30);
    if (other !== birthPlace) residences.push(other);
  }
  record.residences = residences;

  const biography = biographyFor(rng, {
    firstName: input.firstName,
    profession,
    place: birthPlace,
    birthYear,
    branchLabel: input.branchLabel,
  });
  if (biography) record.biography = biography;

  record.custom = { 'Branche familiale': input.branchLabel };

  return record;
}

/**
 * Fait descendre une branche à partir d'un couple fondateur, en largeur, jusqu'à
 * épuisement du budget de personnes ou de la période couverte.
 */
export function expandLineage(seed: LineageSeed, founderBirthYear: number, rngSeed: number): GeneratedLineage {
  const rng = createRng(rngSeed);
  const people: PersonRecord[] = [];
  const singles: GeneratedLineage['singles'] = [];
  let counter = 0;

  const nextId = (firstName: string, lastName: string, birthYear: number): string => {
    counter += 1;
    return `${slug(firstName)}-${slug(lastName)}-${birthYear}-${counter}`;
  };

  const queue: QueueEntry[] = [
    {
      parentIds: [seed.founderId, seed.spouseId],
      parentBirthYear: founderBirthYear,
      // Le couple fondateur est écrit à la main : sa cohérence ne dépend pas
      // du tirage.
      parentDeathYear: Number.POSITIVE_INFINITY,
      lastName: seed.lastName,
      depth: 0,
    },
  ];

  while (queue.length > 0 && people.length < seed.budget) {
    // On développe en priorité le couple le plus récent. Un parcours en largeur
    // épuiserait le budget sur les générations anciennes et laisserait toutes
    // les lignées s'éteindre au XIXᵉ siècle ; ainsi, plusieurs descendances
    // atteignent réellement le présent.
    let nextIndex = 0;
    for (let i = 1; i < queue.length; i += 1) {
      if (queue[i].parentBirthYear > queue[nextIndex].parentBirthYear) nextIndex = i;
    }
    const entry = queue.splice(nextIndex, 1)[0];
    const total = childCount(rng, entry.parentBirthYear);
    let previousBirth = entry.parentBirthYear + between(rng, 22, 28);

    for (let index = 0; index < total; index += 1) {
      if (people.length >= seed.budget) break;

      const birthYear = index === 0 ? previousBirth : previousBirth + between(rng, 2, 5);
      previousBirth = birthYear;
      if (birthYear > LAST_BIRTH_YEAR) break;
      // Un enfant posthume, à la rigueur ; deux ans après, non.
      if (birthYear > entry.parentDeathYear + 1) break;

      const gender: 'f' | 'm' = rng() < 0.5 ? 'f' : 'm';
      const firstName = givenName(rng, birthYear, gender);
      const childId = nextId(firstName, entry.lastName, birthYear);

      const child = makePerson({
        rng,
        id: childId,
        firstName,
        lastName: entry.lastName,
        gender,
        birthYear,
        regionKey: seed.region,
        driftKey: seed.driftRegion,
        branchLabel: seed.label,
        parents: entry.parentIds,
      });
      people.push(child);

      const diedYoung = child.headline === 'Mort en bas âge';
      const marriageYear = birthYear + between(rng, 22, 31);
      const canMarry = !diedYoung && marriageYear <= CURRENT_YEAR && birthYear <= LAST_BIRTH_YEAR - 20;
      if (!canMarry) continue;

      // 9 % restent célibataires : ils serviront à relier deux branches.
      if (rng() < 0.09) {
        singles.push({ id: childId, birthYear, gender, branch: seed.label });
        continue;
      }
      if (people.length >= seed.budget) continue;

      const spouseGender: 'f' | 'm' = gender === 'f' ? 'm' : 'f';
      const spouseBirthYear = birthYear + between(rng, -4, 4);
      const spouseFirstName = givenName(rng, spouseBirthYear, spouseGender);
      const spouseSurname = pick(rng, SURNAMES);
      // Le nom porté par l'épouse est celui du mari, son nom de naissance est conservé.
      const husbandSurname = gender === 'm' ? entry.lastName : spouseSurname;
      const spouseLastName = spouseGender === 'f' ? husbandSurname : spouseSurname;
      const spouseId = nextId(spouseFirstName, spouseSurname, spouseBirthYear);

      const spouse = makePerson({
        rng,
        id: spouseId,
        firstName: spouseFirstName,
        lastName: spouseLastName,
        gender: spouseGender,
        birthYear: spouseBirthYear,
        regionKey: seed.region,
        driftKey: seed.driftRegion,
        branchLabel: seed.label,
        maidenName: spouseGender === 'f' ? spouseSurname : undefined,
        // Il se marie cette année-là : il faut au moins qu'il y soit encore.
        minAge: Math.max(18, marriageYear - spouseBirthYear),
      });

      const divorced = birthYear > 1945 && rng() < 0.13;
      spouse.spouses = [
        {
          id: childId,
          status: divorced ? 'divorced' : rng() < 0.06 ? 'partner' : 'married',
          since: `${marriageYear}-${String(between(rng, 1, 12)).padStart(2, '0')}`,
          place: child.birthPlace,
        },
      ];
      people.push(spouse);

      // Le nom de famille de la fille change en se mariant.
      if (gender === 'f') {
        child.maidenName = entry.lastName;
        child.lastName = husbandSurname;
      }

      const deathOf = (record: PersonRecord): number =>
        record.deathDate ? Number(record.deathDate.slice(0, 4)) : Number.POSITIVE_INFINITY;

      queue.push({
        parentIds: [childId, spouseId],
        parentBirthYear: birthYear,
        parentDeathYear: Math.min(deathOf(child), deathOf(spouse)),
        lastName: husbandSurname,
        depth: entry.depth + 1,
      });
    }
  }

  return { people, singles };
}

/**
 * Marie quelques célibataires appartenant à des branches différentes.
 * Ces unions relient visuellement deux lignées éloignées et donnent à l'arbre
 * la topologie d'une vraie famille plutôt que celle d'un ensemble d'arbres.
 */
export function linkBranches(
  lineages: GeneratedLineage[],
  index: Map<string, PersonRecord>,
  maxLinks = 5,
): number {
  const rng = createRng(0x5eed1);
  const pool = lineages.flatMap((lineage) => lineage.singles);
  const used = new Set<string>();
  let created = 0;

  for (const candidate of pool) {
    if (created >= maxLinks) break;
    if (used.has(candidate.id)) continue;

    const match = pool.find(
      (other) =>
        !used.has(other.id) &&
        other.id !== candidate.id &&
        other.branch !== candidate.branch &&
        other.gender !== candidate.gender &&
        Math.abs(other.birthYear - candidate.birthYear) <= 6,
    );
    if (!match) continue;

    const left = index.get(candidate.id);
    const right = index.get(match.id);
    if (!left || !right) continue;

    const marriageYear = Math.max(candidate.birthYear, match.birthYear) + between(rng, 23, 30);
    left.spouses = [
      ...(left.spouses ?? []),
      { id: match.id, status: 'married', since: `${marriageYear}`, place: left.birthPlace },
    ];
    const note = 'Union entre deux branches de la famille.';
    left.anecdotes = [...(left.anecdotes ?? []), note];

    used.add(candidate.id);
    used.add(match.id);
    created += 1;
  }

  return created;
}
