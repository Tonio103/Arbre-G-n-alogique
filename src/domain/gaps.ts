import type { FamilyGraph } from './graph';

/*
 * ============================================================================
 *
 *  CE QU'ON NE SAIT PAS ENCORE
 *
 *  Cette liste ne relève que des ABSENCES dans les données actuelles. Elle ne
 *  prétend jamais qu'une information existe quelque part, ni qu'elle serait
 *  trouvable : elle dit « ce champ est vide », rien de plus.
 *
 *  L'ordre d'importance suit une idée simple : un manque qui empêche l'arbre
 *  de continuer vaut plus qu'un manque de détail. Ne pas connaître les parents
 *  d'un ancêtre, c'est une branche qui s'arrête ; ne pas connaître son lieu de
 *  naissance, c'est une ligne vide sur une fiche par ailleurs remplie.
 *
 * ==========================================================================*/

export type GapKind =
  | 'parents'
  | 'father'
  | 'mother'
  | 'birthDate'
  | 'birthPlace'
  | 'deathDate'
  | 'deathPlace'
  | 'spouse';

export type GapPriority = 'high' | 'medium' | 'low';

export interface Gap {
  /** Stable : c'est la clé sous laquelle le suivi de recherche est retenu. */
  id: string;
  kind: GapKind;
  personId: string;
  title: string;
  /** Ce qui explique l'importance accordée, en une ligne. */
  note?: string;
  priority: GapPriority;
  /** Ouvre la fiche en modification plutôt que dans l'arbre. */
  editable: boolean;
}

const PRIORITY_RANK: Record<GapPriority, number> = { high: 0, medium: 1, low: 2 };

/** À quel point une fiche est déjà remplie — sert à doser l'importance. */
function documented(graph: FamilyGraph, personId: string): number {
  const person = graph.people.get(personId);
  if (!person) return 0;
  const fields = [
    person.birthDate,
    person.birthPlace,
    person.deathDate,
    person.deathPlace,
    person.profession,
    person.biography,
    person.photo,
  ];
  return fields.filter(Boolean).length + (person.residences?.length ?? 0);
}

/**
 * Relève les manques des personnes du périmètre.
 *
 * Une personne vivante n'a pas de « date de décès manquante » : c'est une
 * absence normale, pas un trou dans la recherche. On ne la signale donc que
 * pour les personnes dont on sait qu'elles sont mortes, ou dont la naissance
 * est assez ancienne pour que la question se pose.
 */
export function findGaps(graph: FamilyGraph, scope: Iterable<string>): Gap[] {
  const gaps: Gap[] = [];
  const thisYear = new Date().getFullYear();

  for (const personId of scope) {
    const person = graph.people.get(personId);
    if (!person) continue;

    const name = person.displayName;
    const known = documented(graph, personId);
    const parents = person.parents.filter((id) => graph.people.has(id));

    /*
     * L'ascendance : c'est ce qui fait avancer un arbre.
     *
     * Aucun parent connu est plus grave qu'un seul manquant — c'est une
     * branche entière qui s'arrête là. On ne le signale pas pour les
     * personnes entrées par alliance sans descendance connue : leur
     * ascendance n'appartient pas encore à cet arbre.
     */
    if (parents.length === 0) {
      gaps.push({
        id: `${personId}:parents`,
        kind: 'parents',
        personId,
        title: `Parents de ${name} inconnus`,
        note: 'La branche s’arrête ici',
        priority: 'high',
        editable: false,
      });
    } else if (parents.length === 1) {
      const known0 = graph.people.get(parents[0]);
      const missingFather = known0?.gender === 'f';
      gaps.push({
        id: `${personId}:${missingFather ? 'father' : 'mother'}`,
        kind: missingFather ? 'father' : 'mother',
        personId,
        title: `${missingFather ? 'Père' : 'Mère'} de ${name} inconnu${missingFather ? '' : 'e'}`,
        note: `Un seul parent connu : ${known0?.displayName ?? '?'}`,
        priority: 'high',
        editable: false,
      });
    }

    if (!person.birthDate) {
      gaps.push({
        id: `${personId}:birthDate`,
        kind: 'birthDate',
        personId,
        title: `Date de naissance de ${name} inconnue`,
        priority: person.children.length > 0 ? 'medium' : 'low',
        editable: true,
      });
    }

    if (!person.birthPlace) {
      gaps.push({
        id: `${personId}:birthPlace`,
        kind: 'birthPlace',
        personId,
        title: `Lieu de naissance de ${name} inconnu`,
        // Une fiche déjà très remplie à laquelle il ne manque qu'un lieu est
        // moins urgente qu'une fiche presque vide.
        priority: known >= 4 ? 'low' : 'medium',
        editable: true,
      });
    }

    // Le décès ne se demande que si la personne n'est pas donnée pour vivante.
    const birthYear = person.birthYear;
    const plausiblyGone = !person.living || (birthYear !== undefined && thisYear - birthYear > 110);

    if (plausiblyGone && !person.deathDate) {
      gaps.push({
        id: `${personId}:deathDate`,
        kind: 'deathDate',
        personId,
        title: `Date de décès de ${name} inconnue`,
        priority: 'medium',
        editable: true,
      });
    }
    if (plausiblyGone && person.deathDate && !person.deathPlace) {
      gaps.push({
        id: `${personId}:deathPlace`,
        kind: 'deathPlace',
        personId,
        title: `Lieu de décès de ${name} inconnu`,
        priority: 'low',
        editable: true,
      });
    }

    /*
     * Un conjoint manquant ne se signale que quand les données elles-mêmes le
     * réclament : des enfants sans second parent. Ailleurs, une personne sans
     * conjoint connu n'a rien d'anormal, et le signaler ferait du bruit.
     */
    if (person.spouseLinks.length === 0 && person.children.length > 0) {
      const orphanSide = person.children.some(
        (childId) => (graph.people.get(childId)?.parents ?? []).length < 2,
      );
      if (orphanSide) {
        gaps.push({
          id: `${personId}:spouse`,
          kind: 'spouse',
          personId,
          title: `Conjoint de ${name} inconnu`,
          note: 'Ses enfants n’ont qu’un parent connu',
          priority: 'medium',
          editable: false,
        });
      }
    }
  }

  gaps.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title),
  );
  return gaps;
}

/* ── Suivi des recherches ────────────────────────────────────────────────────
 *
 * Un état par manque, gardé dans le navigateur. Il ne touche jamais aux
 * données familiales : c'est un pense-bête de recherche, pas une information
 * généalogique, et il ne doit pas pouvoir en abîmer une.
 *
 * Revers assumé : ce suivi est propre à cet appareil et à ce navigateur. Le
 * mettre dans les données partagées voudrait dire écrire dans les fiches à
 * chaque case cochée.
 */

export type GapStatus = 'todo' | 'searching' | 'done';

export const GAP_STATUS_LABELS: Record<GapStatus, string> = {
  todo: 'À rechercher',
  searching: 'Recherche en cours',
  done: 'Complété',
};

const STORAGE_KEY = 'arbre:gap-status';

export function loadGapStatus(): Record<string, GapStatus> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GapStatus>) : {};
  } catch {
    // Navigation privée, stockage refusé : le suivi est un confort, son
    // absence ne doit rien empêcher.
    return {};
  }
}

export function saveGapStatus(status: Record<string, GapStatus>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch {
    /* voir `loadGapStatus` */
  }
}
