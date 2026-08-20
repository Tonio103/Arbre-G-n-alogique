import type { FamilyGraph } from './graph';
import { normalizeText } from './text';

export interface SearchEntry {
  id: string;
  /** Nom complet normalisé : sert aux correspondances exactes et par préfixe. */
  name: string;
  /** Tous les termes recherchables, découpés en mots. */
  tokens: string[];
  generation: number;
  birthYear?: number;
  /** Nombre de relations : départage deux homonymes en faveur du mieux relié. */
  weight: number;
}

export interface SearchHit {
  id: string;
  score: number;
}

export interface SearchIndex {
  entries: SearchEntry[];
  /** Premier caractère → entrées, pour éviter de scanner tout l'index. */
  buckets: Map<string, SearchEntry[]>;
}

export function buildSearchIndex(graph: FamilyGraph): SearchIndex {
  const entries: SearchEntry[] = [];
  const buckets = new Map<string, SearchEntry[]>();

  for (const id of graph.order) {
    const person = graph.people.get(id)!;
    const tokens = person.searchKey.length ? person.searchKey.split(' ') : [];
    const entry: SearchEntry = {
      id,
      name: person.nameKey,
      tokens,
      generation: person.generation,
      birthYear: person.birthYear,
      weight:
        person.children.length +
        person.parents.length +
        person.spouseLinks.length +
        person.siblings.length,
    };
    entries.push(entry);
    for (const token of new Set(tokens.map((t) => t[0]).filter(Boolean))) {
      const bucket = buckets.get(token) ?? [];
      bucket.push(entry);
      buckets.set(token, bucket);
    }
  }

  return { entries, buckets };
}

/**
 * Score d'une entrée pour une requête déjà normalisée.
 * Plus le score est élevé, meilleur le résultat ; 0 signifie « pas de match ».
 */
function scoreEntry(entry: SearchEntry, query: string, queryTokens: string[]): number {
  // À pertinence égale, la personne la mieux reliée passe devant : chercher
  // « Beaumont » dans une famille qui en compte trente doit d'abord proposer
  // celles autour desquelles l'arbre s'organise.
  const centrality = Math.min(entry.weight, 12) + (entry.birthYear ? 2 : 0);

  if (entry.name === query) return 1000 + centrality;
  if (entry.name.startsWith(query)) {
    return 800 - Math.min(entry.name.length - query.length, 60) + centrality;
  }

  let score = 0;
  let matchedTokens = 0;

  for (const queryToken of queryTokens) {
    let best = 0;
    for (let i = 0; i < entry.tokens.length; i += 1) {
      const token = entry.tokens[i];
      if (token === queryToken) {
        best = Math.max(best, 120 - i * 4);
      } else if (token.startsWith(queryToken)) {
        best = Math.max(best, 90 - i * 4 - Math.min(token.length - queryToken.length, 20));
      } else if (queryToken.length >= 3 && token.includes(queryToken)) {
        best = Math.max(best, 45 - i * 3);
      }
    }
    if (best === 0) return 0; // chaque mot de la requête doit être retrouvé
    matchedTokens += 1;
    score += best;
  }

  if (matchedTokens === 0) return 0;
  return score + centrality;
}

export function searchPeople(index: SearchIndex, rawQuery: string, limit = 30): SearchHit[] {
  const query = normalizeText(rawQuery);
  if (query.length === 0) return [];
  const queryTokens = query.split(' ').filter(Boolean);
  if (queryTokens.length === 0) return [];

  // On ne considère que les entrées contenant un mot commençant par la même
  // lettre que le premier mot cherché : sur un grand arbre, cela divise le
  // travail par vingt sans changer les résultats.
  const firstLetter = queryTokens[0][0];
  const candidates = query.length === 1 ? (index.buckets.get(firstLetter) ?? []) : index.entries;
  const pool = candidates.length > 0 ? candidates : index.entries;

  const hits: SearchHit[] = [];
  for (const entry of pool) {
    const score = scoreEntry(entry, query, queryTokens);
    if (score > 0) hits.push({ id: entry.id, score });
  }

  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}
