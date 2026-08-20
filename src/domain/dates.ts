/**
 * Dates généalogiques : souvent partielles, parfois approximatives.
 * Tout accepte "1887", "1887-04", "1887-04-23", "vers 1887", "~1887".
 */

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

interface ParsedDate {
  year: number;
  month?: number;
  day?: number;
  approximate: boolean;
}

export function parseDate(value?: string): ParsedDate | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const approximate = /^(vers|~|env\.?|circa|ca\.?)\s*/i.test(trimmed);
  const cleaned = trimmed.replace(/^(vers|~|env\.?|circa|ca\.?)\s*/i, '');
  const match = /^(\d{3,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(cleaned);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (!Number.isFinite(year)) return undefined;
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;
  return { year, month, day, approximate };
}

export function parseYear(value?: string): number | undefined {
  return parseDate(value)?.year;
}

/** « 23 avril 1887 », « avril 1887 », « 1887 », « vers 1887 ». */
export function formatDate(value?: string): string | undefined {
  const parsed = parseDate(value);
  if (!parsed) return value?.trim() || undefined;
  const prefix = parsed.approximate ? 'vers ' : '';
  if (parsed.month && parsed.day) {
    const month = MONTHS[parsed.month - 1] ?? '';
    const day = parsed.day === 1 ? '1er' : String(parsed.day);
    return `${prefix}${day} ${month} ${parsed.year}`.trim();
  }
  if (parsed.month) {
    return `${prefix}${MONTHS[parsed.month - 1] ?? ''} ${parsed.year}`.trim();
  }
  return `${prefix}${parsed.year}`;
}

/** Forme compacte pour les cartes : « 1887 – 1962 », « 1953 – », « ? ». */
export function formatLifespan(birth?: string, death?: string): string {
  const b = parseYear(birth);
  const d = parseYear(death);
  if (b && d) return `${b} – ${d}`;
  if (b && !d) return `${b} –`;
  if (!b && d) return `† ${d}`;
  return '';
}

export function computeAgeAtDeath(birth?: string, death?: string): number | undefined {
  const b = parseDate(birth);
  const d = parseDate(death);
  if (!b || !d) return undefined;
  let age = d.year - b.year;
  if (b.month && d.month) {
    if (d.month < b.month || (d.month === b.month && b.day && d.day && d.day < b.day)) {
      age -= 1;
    }
  }
  return age >= 0 && age < 130 ? age : undefined;
}

export function computeCurrentAge(birth?: string): number | undefined {
  const b = parseDate(birth);
  if (!b) return undefined;
  const now = new Date();
  let age = now.getFullYear() - b.year;
  if (b.month) {
    const month = now.getMonth() + 1;
    if (month < b.month || (month === b.month && b.day && now.getDate() < b.day)) age -= 1;
  }
  return age >= 0 && age < 130 ? age : undefined;
}
