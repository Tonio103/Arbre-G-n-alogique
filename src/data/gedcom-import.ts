import type { FamilyDataset, Gender, PersonRecord, SpouseLink } from './schema';

/**
 * Lecture d'un fichier GEDCOM.
 *
 * GEDCOM (le format d'échange standard de la généalogie — Ancestry,
 * Geneanet, FamilySearch, Heredis en exportent tous) décrit chaque
 * information sur une ligne : un niveau d'imbrication, un tag, une valeur.
 * `0 @I1@ INDI` ouvre une personne, `1 NAME Jean /Dupont/` lui donne un nom,
 * `2 DATE 12 JAN 1900` précise l'évènement dont elle dépend. On reconstruit
 * d'abord cette imbrication en arbre à partir des niveaux, puis on lit
 * chaque personne (INDI) et chaque union (FAM) dans cet arbre.
 *
 * Le schéma de l'application est volontairement plus simple que GEDCOM (une
 * personne, deux parents au plus, un statut par union) : ce qui ne rentre
 * pas — familles adoptives multiples, personnes sans aucun nom — est
 * signalé dans les avertissements plutôt que de faire échouer tout l'import.
 */

interface GedLine {
  level: number;
  xref?: string;
  tag: string;
  value: string;
}

interface GedNode {
  tag: string;
  value: string;
  xref?: string;
  children: GedNode[];
}

function tokenize(text: string): GedLine[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: GedLine[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(\d+)\s+(@[^@]+@\s+)?(\S+)(?:\s(.*))?$/.exec(line);
    if (!match) continue;
    out.push({
      level: Number(match[1]),
      xref: match[2] ? match[2].trim().replace(/@/g, '') : undefined,
      tag: match[3],
      value: match[4] ?? '',
    });
  }
  return out;
}

function buildTree(lines: GedLine[]): GedNode[] {
  const roots: GedNode[] = [];
  const stack: Array<{ level: number; node: GedNode }> = [];
  for (const line of lines) {
    const node: GedNode = { tag: line.tag, value: line.value, xref: line.xref, children: [] };
    while (stack.length && stack[stack.length - 1].level >= line.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ level: line.level, node });
  }
  return roots;
}

const child = (node: GedNode | undefined, tag: string): GedNode | undefined =>
  node?.children.find((c) => c.tag === tag);

const children = (node: GedNode | undefined, tag: string): GedNode[] =>
  node?.children.filter((c) => c.tag === tag) ?? [];

/** Un champ texte GEDCOM peut se poursuivre sur plusieurs lignes CONT/CONC :
 *  CONT ajoute un retour à la ligne, CONC recolle directement. */
function textOf(node: GedNode | undefined): string | undefined {
  if (!node) return undefined;
  let text = node.value;
  for (const part of node.children) {
    if (part.tag === 'CONT') text += `\n${part.value}`;
    else if (part.tag === 'CONC') text += part.value;
  }
  const trimmed = text.trim();
  return trimmed || undefined;
}

const xrefOf = (node: GedNode | undefined): string | undefined =>
  node?.value ? node.value.replace(/@/g, '').trim() || undefined : undefined;

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

/** GEDCOM encode des dates approximatives ou bornées (ABT, BEF, BET…) que le
 *  schéma de l'application ne représente qu'imprécisément — mieux vaut une
 *  année approximée que rien. */
function convertDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  let text = raw.trim().toUpperCase();
  let approx = false;

  const betweenMatch = /^BET\s+(.+?)\s+AND\s+.+$/.exec(text);
  if (betweenMatch) {
    approx = true;
    text = betweenMatch[1];
  }
  for (const prefix of ['ABT', 'EST', 'CAL', 'BEF', 'AFT']) {
    if (text.startsWith(prefix)) {
      approx = true;
      text = text.slice(prefix.length).trim();
    }
  }

  let day: string | undefined;
  let month: string | undefined;
  let year: string | undefined;
  for (const part of text.split(/\s+/)) {
    if (/^\d{3,4}$/.test(part)) year = part;
    else if (/^\d{1,2}$/.test(part)) day = part.padStart(2, '0');
    else if (MONTHS[part]) month = MONTHS[part];
  }
  if (!year) return undefined;
  let iso = year;
  if (month) iso += `-${month}`;
  if (month && day) iso += `-${day}`;
  return approx ? `vers ${iso}` : iso;
}

/** `Jean Michel /Dupont/` → prénom, seconds prénoms, nom. */
function parseName(raw?: string): { firstName: string; lastName: string; middleNames?: string } {
  if (!raw || !raw.trim()) return { firstName: 'Inconnu·e', lastName: '' };
  const match = /^([^/]*)\/([^/]*)\/?/.exec(raw.trim());
  if (!match) {
    const parts = raw.trim().split(/\s+/);
    return {
      firstName: parts[0] ?? 'Inconnu·e',
      lastName: parts.length > 1 ? parts[parts.length - 1] : '',
    };
  }
  const given = match[1].trim().split(/\s+/).filter(Boolean);
  return {
    firstName: given[0] ?? 'Inconnu·e',
    lastName: match[2].trim(),
    middleNames: given.slice(1).join(' ') || undefined,
  };
}

export interface GedcomImportResult {
  dataset: FamilyDataset;
  warnings: string[];
}

export function parseGedcom(text: string): GedcomImportResult {
  const warnings: string[] = [];
  const roots = buildTree(tokenize(text));

  const indiNodes = roots.filter((r) => r.tag === 'INDI' && r.xref);
  const famNodes = roots.filter((r) => r.tag === 'FAM' && r.xref);

  const prefix = (xref: string): string => `gedcom-${xref}`;
  const records = new Map<string, PersonRecord>();
  const claimedFrom = new Map<string, string>(); // id -> xref de la FAM qui a déjà donné ses parents

  for (const indi of indiNodes) {
    const xref = indi.xref!;
    const { firstName, lastName, middleNames } = parseName(child(indi, 'NAME')?.value);
    const sex = child(indi, 'SEX')?.value;
    const gender: Gender | undefined = sex === 'M' ? 'm' : sex === 'F' ? 'f' : undefined;
    const birt = child(indi, 'BIRT');
    const deat = child(indi, 'DEAT');
    const notes = children(indi, 'NOTE')
      .map((n) => textOf(n))
      .filter((n): n is string => !!n)
      .join('\n\n');
    const residences = children(indi, 'RESI')
      .map((r) => textOf(child(r, 'PLAC')))
      .filter((p): p is string => !!p);

    const record: PersonRecord = {
      id: prefix(xref),
      firstName,
      lastName,
      middleNames,
      gender,
      birthDate: convertDate(child(birt, 'DATE')?.value),
      birthPlace: textOf(child(birt, 'PLAC')),
      deathDate: convertDate(child(deat, 'DATE')?.value),
      deathPlace: textOf(child(deat, 'PLAC')),
      profession: textOf(child(indi, 'OCCU')),
      notes: notes || undefined,
      residences: residences.length > 0 ? residences : undefined,
      parents: [],
      spouses: [],
    };
    records.set(xref, record);
  }

  if (indiNodes.length === 0) {
    warnings.push('Aucune personne (INDI) trouvée dans ce fichier.');
  }

  for (const fam of famNodes) {
    const husbXref = xrefOf(child(fam, 'HUSB'));
    const wifeXref = xrefOf(child(fam, 'WIFE'));
    const marr = child(fam, 'MARR');
    const marriageDate = convertDate(child(marr, 'DATE')?.value);
    const marriagePlace = textOf(child(marr, 'PLAC'));
    const divorced = !!child(fam, 'DIV');

    const partners = [husbXref, wifeXref].filter(
      (x): x is string => !!x && records.has(x),
    );

    for (const chil of children(fam, 'CHIL')) {
      const childXref = xrefOf(chil);
      const childRecord = childXref ? records.get(childXref) : undefined;
      if (!childRecord || !childXref) continue;
      if (claimedFrom.has(childXref)) {
        warnings.push(
          `${childRecord.firstName} ${childRecord.lastName} apparaît dans plusieurs familles ; seule la première est gardée (une personne n'a qu'un seul jeu de parents dans cette application).`,
        );
        continue;
      }
      claimedFrom.set(childXref, fam.xref!);
      childRecord.parents = partners.map(prefix);
    }

    if (partners.length === 2) {
      const [a, b] = partners;
      const recA = records.get(a)!;
      const recB = records.get(b)!;
      const status: SpouseLink['status'] = divorced ? 'divorced' : marriageDate ? 'married' : 'partner';
      (recA.spouses as SpouseLink[]).push({ id: prefix(b), status, since: marriageDate, place: marriagePlace });
      (recB.spouses as SpouseLink[]).push({ id: prefix(a), status, since: marriageDate, place: marriagePlace });
    } else if (partners.length === 1 && children(fam, 'CHIL').length > 0) {
      warnings.push(
        `Famille avec un seul parent connu — les enfants concernés n'ont qu'un parent dans l'arbre.`,
      );
    }
  }

  const people = [...records.values()];
  const rootId = people[0]?.id ?? '';

  const dataset: FamilyDataset = {
    title: 'Ma famille',
    subtitle: `Importée depuis un fichier GEDCOM — ${people.length} personne${people.length > 1 ? 's' : ''}`,
    rootId,
    people,
  };

  return { dataset, warnings };
}
