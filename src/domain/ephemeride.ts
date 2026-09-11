import type { FamilyGraph } from './graph';
import { parseDate } from './dates';

/* ═══════════════════════════════════════════════════════════════════════════
 * L'ÉPHÉMÉRIDE
 *
 * Ce que la famille a à fêter, ou à se rappeler, ces jours-ci.
 *
 * ── POURQUOI ÇA MANQUAIT ─────────────────────────────────────────────────
 *
 * L'application connaissait la date de naissance de chacun et n'a jamais dit
 * une seule fois que c'était l'anniversaire de quelqu'un. Elle ne parlait que
 * du passé : un arbre, une frise, une carte, tous tournés vers ce qui a eu
 * lieu. Rien n'y donnait de raison de l'ouvrir un mardi.
 *
 * ── LA RÈGLE D'HONNÊTETÉ ─────────────────────────────────────────────────
 *
 * Un anniversaire demande un JOUR et un MOIS. Une date réduite à son année ne
 * peut rien fêter, et une date donnée pour approximative — « vers 1887 » — ne
 * le peut pas davantage. Elles sont écartées, en silence : mieux vaut une
 * éphéméride courte qu'une éphéméride qui invente.
 *
 * ── LES VIVANTS ET LES AUTRES ────────────────────────────────────────────
 *
 * Le même jour de calendrier ne se dit pas pareil selon que la personne est
 * là ou non. Pour un vivant, c'est un anniversaire et l'on donne son âge.
 * Pour quelqu'un qui n'est plus là, ce n'en est pas un : c'est une date qui
 * revient, et l'on ne la mentionne qu'aux tournants — le centenaire d'une
 * naissance, le cap d'une disparition. Souhaiter « bon anniversaire » à un
 * mort serait la faute que cette distinction existe pour éviter.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type SorteEvenement =
  | 'anniversaire'
  | 'anniversaire-rond'
  | 'alliance'
  | 'memoire';

export interface Evenement {
  id: string;
  sorte: SorteEvenement;
  /** Dans combien de jours, à partir d'aujourd'hui. 0 = aujourd'hui. */
  dans: number;
  /** La personne concernée — celle vers qui mène le clic. */
  personId: string;
  /** Le second conjoint, pour une alliance. */
  autreId?: string;
  /** Ce qu'on lit en gras : un nom, ou deux. */
  qui: string;
  /** Ce qu'on lit dessous, déjà rédigé. */
  dit: string;
  /** Le nombre d'années révolues, quand il a un sens. */
  ans?: number;
}

/** Combien de jours d'avance l'éphéméride regarde. */
export const FENETRE_JOURS = 14;

/**
 * Les caps qui se remarquent.
 *
 * Avant vingt ans, chaque année compte pour qui la fête ; après, ce sont les
 * dizaines qu'on retient, et les quarts de siècle entre elles. Une liste
 * plutôt qu'un modulo : « 18 ans » n'est un cap pour aucune règle
 * arithmétique, et c'en est un pour tout le monde.
 */
const CAPS = new Set([1, 5, 10, 16, 18, 20, 25, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 100, 105, 110]);

/** Le jour de l'année, sans l'année : ce qui revient. */
function jourDeCalendrier(mois: number, jour: number, annee: number): Date {
  return new Date(annee, mois - 1, jour);
}

/**
 * La prochaine occurrence de ce jour de calendrier — dans combien de jours, et
 * SUR QUELLE ANNÉE elle tombe.
 *
 * Les deux vont ensemble, et c'est tout l'intérêt de les rendre ensemble : un
 * anniversaire du 3 janvier regardé le 28 décembre appartient à l'année
 * SUIVANTE. Calculer l'âge sur l'année courante le donnerait faux d'un an,
 * quinze jours par an, et personne ne penserait à vérifier en décembre.
 *
 * Rend `null` au-delà de la fenêtre. Le 29 février est ramené au 1er mars les
 * années communes : c'est ce que fait l'état civil, et se taire trois ans sur
 * quatre serait pire.
 */
function prochaine(
  mois: number,
  jour: number,
  aujourdhui: Date,
  fenetre: number,
): { dans: number; annee: number } | null {
  const base = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());

  for (const annee of [base.getFullYear(), base.getFullYear() + 1]) {
    let cible = jourDeCalendrier(mois, jour, annee);
    // Un 29 février replié : le constructeur l'a déjà porté au 1er mars, mais
    // seulement si le mois a débordé — on s'assure que c'est bien le cas.
    if (mois === 2 && jour === 29 && cible.getMonth() !== 1) {
      cible = jourDeCalendrier(3, 1, annee);
    }
    const ecart = Math.round((cible.getTime() - base.getTime()) / 86_400_000);
    if (ecart >= 0 && ecart <= fenetre) return { dans: ecart, annee };
  }
  return null;
}

/** Une date utilisable pour une éphéméride : jour, mois, et rien d'approximatif. */
function dateExacte(valeur?: string): { annee: number; mois: number; jour: number } | null {
  const parsed = parseDate(valeur);
  if (!parsed || parsed.approximate) return null;
  if (parsed.month === undefined || parsed.day === undefined) return null;
  return { annee: parsed.year, mois: parsed.month, jour: parsed.day };
}

/**
 * Ce qu'il y a à fêter ou à se rappeler dans les jours qui viennent.
 *
 * `aujourdhui` est passé plutôt que lu : une fonction qui interroge l'horloge
 * ne se vérifie qu'en attendant le bon jour.
 */
export function ephemeride(
  graph: FamilyGraph,
  scope: Iterable<string>,
  aujourdhui = new Date(),
  fenetre = FENETRE_JOURS,
): Evenement[] {
  const evenements: Evenement[] = [];

  for (const id of scope) {
    const person = graph.people.get(id);
    if (!person) continue;

    // ── Naissances ──────────────────────────────────────────────────────
    const naissance = dateExacte(person.birthDate);
    if (naissance) {
      const occurrence = prochaine(naissance.mois, naissance.jour, aujourdhui, fenetre);
      if (occurrence !== null) {
        const { dans } = occurrence;
        // L'âge se compte sur l'année où tombe le jour, jamais sur l'année
        // courante — voir `prochaine`.
        const ans = occurrence.annee - naissance.annee;

        if (person.living) {
          evenements.push({
            id: `naissance:${id}`,
            sorte: CAPS.has(ans) ? 'anniversaire-rond' : 'anniversaire',
            dans,
            personId: id,
            qui: person.displayName,
            dit: `${ans} ans`,
            ans,
          });
        } else if (ans > 0 && ans % 50 === 0) {
          /* Pour quelqu'un qui n'est plus là, seul un demi-siècle rond se
             mentionne — et jamais comme un anniversaire. Signaler chaque
             année de chaque défunt remplirait l'éphéméride de gens qu'on ne
             peut pas fêter. */
          evenements.push({
            id: `memoire:${id}`,
            sorte: 'memoire',
            dans,
            personId: id,
            qui: person.displayName,
            dit: `né${person.gender === 'f' ? 'e' : ''} il y a ${ans} ans`,
            ans,
          });
        }
      }
    }

    // ── Alliances ───────────────────────────────────────────────────────
    for (const link of person.spouseLinks) {
      const autre = graph.people.get(link.id);
      if (!autre) continue;
      // Une union est portée par les deux conjoints : on ne la note qu'une
      // fois, du côté du plus petit identifiant.
      if (id > link.id) continue;
      // Un mariage dissous ne se fête pas.
      if (link.status === 'divorced') continue;
      // Et il faut être deux pour le fêter.
      if (!person.living || !autre.living) continue;

      const union = dateExacte(link.since);
      if (!union) continue;
      const occurrence = prochaine(union.mois, union.jour, aujourdhui, fenetre);
      if (occurrence === null) continue;
      const { dans } = occurrence;
      const ans = occurrence.annee - union.annee;
      if (ans <= 0) continue;

      evenements.push({
        id: `alliance:${id}+${link.id}`,
        sorte: 'alliance',
        dans,
        personId: id,
        autreId: link.id,
        qui: `${person.firstName} et ${autre.firstName}`,
        dit: `${ans} ans de mariage`,
        ans,
      });
    }
  }

  /*
   * Le plus proche d'abord, et à égalité de jour, ce qui se fête avant ce
   * qui se rappelle : on ouvre l'application pour souhaiter quelque chose,
   * pas pour être mis devant une commémoration.
   */
  const rang: Record<SorteEvenement, number> = {
    'anniversaire-rond': 0,
    anniversaire: 1,
    alliance: 2,
    memoire: 3,
  };
  evenements.sort((a, b) => a.dans - b.dans || rang[a.sorte] - rang[b.sorte]);
  return evenements;
}

/** « aujourd'hui », « demain », « dans 5 jours », « le 24 mars ». */
export function quand(dans: number, aujourdhui = new Date()): string {
  if (dans === 0) return 'aujourd’hui';
  if (dans === 1) return 'demain';
  if (dans <= 6) return `dans ${dans} jours`;
  const cible = new Date(aujourdhui.getTime() + dans * 86_400_000);
  return `le ${cible.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}
