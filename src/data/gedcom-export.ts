import type { FamilyGraph } from '@/domain/graph';
import { parseDate } from '@/domain/dates';
import type { Person, Union } from './schema';

/**
 * Écriture d'un fichier GEDCOM à partir du graphe affiché.
 *
 * Le sens inverse de `gedcom-import.ts` : sert à sortir une copie de
 * secours (ou à réimporter ailleurs) de ce qui vit dans le navigateur — sa
 * seule mémoire, en l'absence de serveur. Ne réexporte que ce que le
 * schéma de l'application représente réellement : une biographie ou une
 * anecdote devient une NOTE, un lien externe n'a pas d'équivalent GEDCOM
 * standard et est silencieusement omis.
 */

function escapeLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Une valeur trop longue pour une seule ligne GEDCOM (limite usuelle : 255
 *  caractères) se poursuit sur des lignes CONT au niveau suivant. */
function writeMultiline(lines: string[], level: number, tag: string, text: string): void {
  const paragraphs = text.split('\n');
  paragraphs.forEach((paragraph, index) => {
    const chunks = paragraph.match(/.{1,200}/g) ?? [''];
    chunks.forEach((chunk, chunkIndex) => {
      if (index === 0 && chunkIndex === 0) lines.push(`${level} ${tag} ${chunk}`);
      else lines.push(`${level + 1} CONT ${chunk}`);
    });
  });
}

/** "1887-04-23" / "vers 1887" → "23 APR 1887" / "ABT 1887", le format attendu
 *  par un lecteur GEDCOM. */
function toGedcomDate(value?: string): string | undefined {
  const parsed = parseDate(value);
  if (!parsed) return undefined;
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];
  let date = `${parsed.year}`;
  if (parsed.month) date = `${months[parsed.month - 1]} ${date}`;
  if (parsed.day) date = `${parsed.day} ${date}`;
  return parsed.approximate ? `ABT ${date}` : date;
}

function nameLine(person: Person): string {
  const given = [person.firstName, person.middleNames].filter(Boolean).join(' ');
  return `${escapeLine(given)} /${escapeLine(person.lastName ?? '')}/`;
}

export function exportGedcom(graph: FamilyGraph): string {
  const lines: string[] = [];
  lines.push('0 HEAD');
  lines.push('1 SOUR ArbreGenealogique');
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');

  const indiRef = (id: string): string => `@I${id}@`;
  const famRef = (id: string): string => `@F${id}@`;

  for (const person of graph.people.values()) {
    lines.push(`0 ${indiRef(person.id)} INDI`);
    lines.push(`1 NAME ${nameLine(person)}`);
    if (person.gender === 'm' || person.gender === 'f') {
      lines.push(`1 SEX ${person.gender.toUpperCase()}`);
    }
    if (person.birthDate || person.birthPlace) {
      lines.push('1 BIRT');
      const date = toGedcomDate(person.birthDate);
      if (date) lines.push(`2 DATE ${date}`);
      if (person.birthPlace) lines.push(`2 PLAC ${escapeLine(person.birthPlace)}`);
    }
    if (person.deathDate || person.deathPlace) {
      lines.push('1 DEAT');
      const date = toGedcomDate(person.deathDate);
      if (date) lines.push(`2 DATE ${date}`);
      if (person.deathPlace) lines.push(`2 PLAC ${escapeLine(person.deathPlace)}`);
    }
    if (person.profession) lines.push(`1 OCCU ${escapeLine(person.profession)}`);
    for (const residence of person.residences ?? []) {
      lines.push('1 RESI');
      lines.push(`2 PLAC ${escapeLine(residence)}`);
    }
    const note = [person.biography, person.notes].filter(Boolean).join('\n\n');
    if (note) writeMultiline(lines, 1, 'NOTE', note);

    if (person.originUnionId) lines.push(`1 FAMC ${famRef(person.originUnionId)}`);
    for (const unionId of person.unionIds) lines.push(`1 FAMS ${famRef(unionId)}`);
  }

  for (const union of graph.unions.values()) {
    lines.push(...unionLines(union, graph, famRef, indiRef));
  }

  lines.push('0 TRLR');
  return lines.join('\n');
}

function unionLines(
  union: Union,
  graph: FamilyGraph,
  famRef: (id: string) => string,
  indiRef: (id: string) => string,
): string[] {
  const lines: string[] = [];
  lines.push(`0 ${famRef(union.id)} FAM`);
  const partners = union.partners
    .map((id) => graph.people.get(id))
    .filter((p): p is Person => !!p);
  const husband = partners.find((p) => p.gender === 'm') ?? partners[0];
  const wife = partners.find((p) => p.id !== husband?.id);
  if (husband) lines.push(`1 HUSB ${indiRef(husband.id)}`);
  if (wife) lines.push(`1 WIFE ${indiRef(wife.id)}`);
  for (const childId of union.children) lines.push(`1 CHIL ${indiRef(childId)}`);
  if (union.status === 'married' || union.status === 'partner' || union.since || union.until) {
    lines.push('1 MARR');
    const date = toGedcomDate(union.since);
    if (date) lines.push(`2 DATE ${date}`);
    if (union.place) lines.push(`2 PLAC ${escapeLine(union.place)}`);
  }
  if (union.status === 'divorced') {
    lines.push('1 DIV');
    const date = toGedcomDate(union.until);
    if (date) lines.push(`2 DATE ${date}`);
  }
  return lines;
}
