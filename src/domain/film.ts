import type { FamilyGraph } from './graph';
import type { GenerationRow, TreeLayout } from './layout';
import { collectScopedPlaces, type ScopedPlace } from './places';
import type { Person } from '@/data/schema';

/* ═══════════════════════════════════════════════════════════════════════════
 * LE SCÉNARIO
 *
 * Un film sur une famille, déduit de ses données — pas un montage écrit à la
 * main qui vaudrait pour une seule famille et mentirait sur toutes les autres.
 * Ce fichier ne dessine rien et n'anime rien : il RÉPOND aux questions dont un
 * film a besoin, dans l'ordre où il les pose.
 *
 * ── CE QUI A ÉTÉ JETÉ, ET POURQUOI ──────────────────────────────────────
 *
 * La première version enchaînait une rangée de générations par plan : neuf
 * cartons « 1800s · 16 personnes » à la file, sur un arbre qui ne bougeait
 * pas d'une image. Trois défauts, et le troisième était fatal.
 *
 * · ELLE SE RÉPÉTAIT. Neuf plans construits pareil, cadrés pareil, légendés
 *   pareil. Un chapitre qu'on peut copier huit fois n'est pas un chapitre.
 *
 * · ELLE NE PARLAIT DE PERSONNE. « Seize personnes » n'est pas une histoire
 *   de famille, c'est un inventaire. On regarde un film de famille pour
 *   apprendre que quelqu'un a vécu quatre-vingt-quatorze ans, pas pour lire
 *   un décompte.
 *
 * · ELLE MONTRAIT LE CONTRAIRE DE CE QU'ELLE DISAIT. Le carton annonçait
 *   « Les racines » pendant que l'arbre entier restait à l'écran, cinq cents
 *   personnes comprises. Un plan qui contredit sa propre légende ne se
 *   rattrape par aucune mise en scène.
 *
 * Ce que le scénario produit désormais, c'est une MISE EN SCÈNE : chaque acte
 * dit non seulement ce qu'on lit, mais qui l'on montre et quelles branches
 * sont encrées. Le tracé, lui, obéit — voir `FilmView`.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ActeKind =
  | 'titre'
  | 'racines'
  | 'pousse'
  | 'portrait'
  | 'lieux'
  | 'vivants'
  | 'final';

export interface Acte {
  kind: ActeKind;
  /** Durée du plan, en millisecondes. */
  duree: number;
  titre?: string;
  /** La ligne de dessous : une précision, jamais une redite du titre. */
  sous?: string;
  /** Le millésime affiché en grand pendant l'acte, s'il en porte un. */
  annee?: number;
  /**
   * LES SEULES PERSONNES DESSINÉES pendant ce plan. `undefined` : tout
   * l'arbre.
   *
   * C'est ce qui manquait le plus à la première version. Un plan de cinéma
   * cadre ET choisit ce qui entre dans le cadre ; une caméra qui se contente
   * de s'approcher d'une foule ne raconte rien.
   */
  montre?: Set<string>;
  /** Sur qui la caméra se pose. Le film y va, le scénario ne fait que le dire. */
  regarde?: string[];
  /** La personne dont on fait le portrait, pour les plans rapprochés. */
  sujet?: string;
  /**
   * Les rangées à traverser, pour l'acte de croissance.
   *
   * Un SEUL acte les porte toutes : l'arbre pousse d'un mouvement continu au
   * lieu de neuf plans coupés. On y gagne le geste qui manquait — quelque
   * chose qui s'étend — et l'on y perd huit coupes qui ne disaient rien.
   */
  rangees?: GenerationRow[];
  /** L'étendue d'années couverte par l'acte, pour le compteur qui court. */
  de?: number;
  a?: number;
  lieux?: ScopedPlace[];
  trajectoire?: Etape[];
}

/**
 * UNE ÉTAPE DU DÉPLACEMENT : le centre de gravité d'une génération.
 *
 * Le premier essai reliait les lieux dans l'ordre de leur première date. Le
 * résultat, vérifié à l'écran, était une toile d'araignée en travers de la
 * France : des dates voisines n'impliquent aucune proximité géographique, et
 * relier deux lieux parce qu'ils se suivent dans le temps ne raconte rien.
 *
 * La moyenne des lieux de naissance d'une génération, elle, se déplace
 * vraiment. Ce n'est pas un endroit où quelqu'un a vécu, et le film ne le
 * prétend pas : c'est un centre, et la légende le dit.
 */
export interface Etape {
  generation: number;
  label: string;
  lat: number;
  lon: number;
  compte: number;
}

export interface Scenario {
  actes: Acte[];
  duree: number;
  titre: string;
  de?: number;
  a?: number;
}

function pluriel(n: number, singulier: string, pluriel_: string): string {
  return `${n} ${n > 1 ? pluriel_ : singulier}`;
}

/** L'âge atteint, quand les deux bouts sont connus. */
function age(person: Person): number | undefined {
  if (person.birthYear === undefined || person.deathYear === undefined) return undefined;
  const valeur = person.deathYear - person.birthYear;
  // Une vie de plus de cent dix ans ou de durée négative signale une saisie
  // fautive, pas un record : on ne bâtit pas un plan de film là-dessus.
  return valeur >= 0 && valeur <= 110 ? valeur : undefined;
}

/**
 * Les doyens : ceux qui portent la date la plus ancienne de l'arbre.
 *
 * Pas simplement « la génération la plus haute » : dans un arbre importé,
 * celle-ci peut ne contenir qu'une personne sans aucune date, arrivée là par
 * un lien mal saisi. On cherche donc une date, puis on ramasse tout ce qui
 * l'entoure à une génération près.
 */
function doyensDe(graph: FamilyGraph, layout: TreeLayout): string[] {
  let meilleure = Infinity;
  for (const id of layout.positions.keys()) {
    const annee = graph.people.get(id)?.birthYear;
    if (annee !== undefined && annee < meilleure) meilleure = annee;
  }
  if (!Number.isFinite(meilleure)) return [];
  const doyens: string[] = [];
  for (const id of layout.positions.keys()) {
    const person = graph.people.get(id);
    if (person?.birthYear !== undefined && person.birthYear <= meilleure + 24) doyens.push(id);
  }
  return doyens.slice(0, 6);
}

/** Le lieu le plus fréquent d'un ensemble de personnes, s'il y en a un. */
function berceau(graph: FamilyGraph, ids: string[]): string | undefined {
  const comptes = new Map<string, number>();
  for (const id of ids) {
    const lieu = graph.people.get(id)?.birthPlace;
    if (!lieu) continue;
    comptes.set(lieu, (comptes.get(lieu) ?? 0) + 1);
  }
  let meilleur: string | undefined;
  let max = 0;
  for (const [lieu, n] of comptes) {
    if (n > max) {
      max = n;
      meilleur = lieu;
    }
  }
  return meilleur;
}

/** La personne et ses proches immédiats — ce qu'un portrait doit cadrer. */
function entourage(graph: FamilyGraph, layout: TreeLayout, id: string): Set<string> {
  const gens = new Set<string>([id]);
  const person = graph.people.get(id);
  if (person) {
    for (const link of person.spouseLinks) gens.add(link.id);
    for (const parent of person.parents) gens.add(parent);
    for (const enfant of person.children) gens.add(enfant);
    for (const frere of person.siblings) gens.add(frere);
  }
  for (const membre of [...gens]) if (!layout.positions.has(membre)) gens.delete(membre);
  return gens;
}

/* ── LES PORTRAITS ────────────────────────────────────────────────────────
 *
 * Le cœur du film, et ce qui manquait entièrement.
 *
 * Chaque portrait est un FAIT vérifiable tiré des données, pas une formule.
 * Aucun n'est produit s'il n'a pas de quoi être vrai : sans dates, pas de
 * doyen ; sans fratrie de plus de trois, pas de grande fratrie. Un film qui
 * remplirait ses plans avec « la personne la plus intéressante » aurait tout
 * inventé.
 */
interface Portrait {
  id: string;
  titre: string;
  sous: string;
  annee?: number;
}

function portraitsDe(graph: FamilyGraph, layout: TreeLayout): Portrait[] {
  const dansLArbre = (id: string): Person | undefined =>
    layout.positions.has(id) ? graph.people.get(id) : undefined;

  const portraits: Portrait[] = [];

  // La plus longue vie.
  let doyen: { person: Person; ans: number } | null = null;
  for (const id of layout.positions.keys()) {
    const person = dansLArbre(id);
    if (!person) continue;
    const ans = age(person);
    if (ans !== undefined && (!doyen || ans > doyen.ans)) doyen = { person, ans };
  }
  if (doyen && doyen.ans >= 70) {
    portraits.push({
      id: doyen.person.id,
      titre: doyen.person.displayName,
      sous: `La plus longue vie de l’arbre : ${doyen.ans} ans.`,
      annee: doyen.person.birthYear,
    });
  }

  // La plus grande fratrie, nommée par son aîné.
  let fratrie: { person: Person; n: number } | null = null;
  for (const union of layout.unions) {
    if (union.children.length < 4) continue;
    const aine = union.children
      .map((enfant) => graph.people.get(enfant.id))
      .filter((p): p is Person => Boolean(p))
      .sort((x, y) => (x.birthYear ?? 9999) - (y.birthYear ?? 9999))[0];
    if (aine && (!fratrie || union.children.length > fratrie.n)) {
      fratrie = { person: aine, n: union.children.length };
    }
  }
  if (fratrie) {
    portraits.push({
      id: fratrie.person.id,
      titre: fratrie.person.displayName,
      sous: `Aîné${fratrie.person.gender === 'f' ? 'e' : ''} d’une fratrie de ${fratrie.n}.`,
      annee: fratrie.person.birthYear,
    });
  }

  /*
   * CELUI QUI A TRAVERSÉ UN SIÈCLE.
   *
   * Né avant un changement de siècle et mort après : c'est la seule
   * formulation qui tienne sans rien supposer, et elle dit quelque chose que
   * personne ne lit dans un tableau de dates.
   */
  let passeur: { person: Person; siecle: number } | null = null;
  for (const id of layout.positions.keys()) {
    const person = dansLArbre(id);
    if (!person?.birthYear || !person.deathYear) continue;
    const siecle = Math.floor(person.deathYear / 100) * 100;
    if (person.birthYear < siecle && person.deathYear >= siecle) {
      if (!passeur || siecle > passeur.siecle) passeur = { person, siecle };
    }
  }
  if (passeur && !portraits.some((p) => p.id === passeur!.person.id)) {
    portraits.push({
      id: passeur.person.id,
      titre: passeur.person.displayName,
      sous: `${passeur.person.birthYear} – ${passeur.person.deathYear} : ${
        passeur.person.gender === 'f' ? 'elle a' : 'il a'
      } vu changer de siècle.`,
      annee: passeur.siecle,
    });
  }

  // Le prénom le plus porté, et la dernière personne à le porter.
  const prenoms = new Map<string, string[]>();
  for (const id of layout.positions.keys()) {
    const person = dansLArbre(id);
    if (!person?.firstName) continue;
    const liste = prenoms.get(person.firstName) ?? [];
    liste.push(id);
    prenoms.set(person.firstName, liste);
  }
  let repete: { prenom: string; ids: string[] } | null = null;
  for (const [prenom, ids] of prenoms) {
    if (ids.length >= 3 && (!repete || ids.length > repete.ids.length)) repete = { prenom, ids };
  }
  if (repete) {
    const dernier = repete.ids
      .map((id) => graph.people.get(id))
      .filter((p): p is Person => Boolean(p))
      .sort((x, y) => (y.birthYear ?? 0) - (x.birthYear ?? 0))[0];
    if (dernier && !portraits.some((p) => p.id === dernier.id)) {
      portraits.push({
        id: dernier.id,
        titre: repete.prenom,
        sous: `Le prénom revient ${repete.ids.length} fois dans l’arbre. ${
          dernier.displayName
        } est le dernier à le porter.`,
        annee: dernier.birthYear,
      });
    }
  }

  return portraits.slice(0, 4);
}

const DUREE_TITRE = 4600;
const DUREE_RACINES = 5600;
/** L'acte de croissance : long, parce que c'est le seul mouvement du film. */
const DUREE_POUSSE_PAR_RANGEE = 1500;
const DUREE_POUSSE_MIN = 7000;
const DUREE_POUSSE_MAX = 16000;
const DUREE_PORTRAIT = 4800;
const DUREE_LIEUX = 7000;
const DUREE_VIVANTS = 4800;
const DUREE_FINAL = 5200;

export function buildScenario(
  graph: FamilyGraph,
  layout: TreeLayout,
  gapCount: number,
): Scenario {
  const actes: Acte[] = [];

  const annees: number[] = [];
  for (const id of layout.positions.keys()) {
    const person = graph.people.get(id);
    if (person?.birthYear !== undefined) annees.push(person.birthYear);
    if (person?.deathYear !== undefined) annees.push(person.deathYear);
  }
  const de = annees.length > 0 ? Math.min(...annees) : undefined;
  const a = annees.length > 0 ? Math.max(...annees) : undefined;

  // ── I. Le titre ────────────────────────────────────────────────────────
  actes.push({
    kind: 'titre',
    duree: DUREE_TITRE,
    titre: graph.title,
    sous: [
      pluriel(layout.positions.size, 'personne', 'personnes'),
      pluriel(layout.rows.length, 'génération', 'générations'),
      de !== undefined && a !== undefined ? `${de} — ${a}` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
  });

  // ── II. Les racines ────────────────────────────────────────────────────
  const doyens = doyensDe(graph, layout);
  if (doyens.length > 0) {
    const premier = graph.people.get(doyens[0]);
    const lieu = berceau(graph, doyens);
    actes.push({
      kind: 'racines',
      duree: DUREE_RACINES,
      titre: 'Les racines',
      sous: premier?.birthYear
        ? `Tout ce qu’on sait commence en ${premier.birthYear}${lieu ? `, à ${lieu}` : ''}.`
        : 'Tout ce qu’on sait commence ici.',
      annee: premier?.birthYear,
      regarde: doyens,
      // Seuls les doyens sont posés : c'est un plan sur des racines, pas sur
      // un arbre dont on cite les racines.
      montre: new Set(doyens),
    });
  }

  // ── III. L'arbre pousse — UN SEUL PLAN, continu ────────────────────────
  if (layout.rows.length > 1) {
    const rangees = layout.rows;
    actes.push({
      kind: 'pousse',
      duree: Math.max(
        DUREE_POUSSE_MIN,
        Math.min(DUREE_POUSSE_MAX, rangees.length * DUREE_POUSSE_PAR_RANGEE),
      ),
      titre: 'Et la famille pousse',
      sous: `${pluriel(layout.rows.length, 'génération', 'générations')}, ${pluriel(
        layout.positions.size,
        'personne',
        'personnes',
      )}.`,
      rangees,
      de,
      a,
    });
  }

  // ── IV. Les portraits ──────────────────────────────────────────────────
  for (const portrait of portraitsDe(graph, layout)) {
    actes.push({
      kind: 'portrait',
      duree: DUREE_PORTRAIT,
      titre: portrait.titre,
      sous: portrait.sous,
      annee: portrait.annee,
      sujet: portrait.id,
      regarde: [portrait.id],
      montre: entourage(graph, layout, portrait.id),
    });
  }

  // ── V. Les lieux ───────────────────────────────────────────────────────
  const rapport = collectScopedPlaces(graph, layout.positions.keys());
  if (rapport.places.length >= 2) {
    const ordonnes = [...rapport.places].sort(
      (x, y) => (x.earliestYear ?? 99999) - (y.earliestYear ?? 99999),
    );

    /*
     * Le centre de gravité de chaque génération, dans l'ordre.
     *
     * Seules les NAISSANCES entrent dans la moyenne : c'est le seul événement
     * qu'une personne ne choisit pas, et donc le seul qui dise où sa famille
     * se trouvait à ce moment-là.
     */
    const parGeneration = new Map<number, { lat: number; lon: number; n: number }>();
    for (const id of layout.positions.keys()) {
      const person = graph.people.get(id);
      if (!person?.birthPlace) continue;
      const lieu = rapport.places.find((candidat) => candidat.people.includes(id));
      if (!lieu) continue;
      const cumul = parGeneration.get(person.generation) ?? { lat: 0, lon: 0, n: 0 };
      cumul.lat += lieu.lat;
      cumul.lon += lieu.lon;
      cumul.n += 1;
      parGeneration.set(person.generation, cumul);
    }

    const trajectoire: Etape[] = [];
    for (const rangee of layout.rows) {
      const cumul = parGeneration.get(rangee.generation);
      // Une génération dont on ne situe personne n'a pas de centre. L'inventer
      // dessinerait un déplacement qui n'a jamais eu lieu.
      if (!cumul || cumul.n === 0) continue;
      trajectoire.push({
        generation: rangee.generation,
        label: rangee.label,
        lat: cumul.lat / cumul.n,
        lon: cumul.lon / cumul.n,
        compte: cumul.n,
      });
    }

    const premier = ordonnes[0];
    const dernier = [...ordonnes].reverse().find((lieu) => lieu.earliestYear !== undefined);
    actes.push({
      kind: 'lieux',
      duree: DUREE_LIEUX,
      titre: 'Les lieux',
      sous:
        dernier && premier && dernier.key !== premier.key
          ? `De ${premier.label} à ${dernier.label} — ${pluriel(
              rapport.places.length,
              'lieu',
              'lieux',
            )} en tout.`
          : `${pluriel(rapport.places.length, 'lieu', 'lieux')}.`,
      lieux: ordonnes,
      trajectoire: trajectoire.length >= 2 ? trajectoire : undefined,
    });
  }

  // ── VI. Les vivants ────────────────────────────────────────────────────
  const vivants: string[] = [];
  for (const id of layout.positions.keys()) {
    if (graph.people.get(id)?.living) vivants.push(id);
  }
  if (vivants.length > 0) {
    actes.push({
      kind: 'vivants',
      duree: DUREE_VIVANTS,
      titre: 'Aujourd’hui',
      sous: `${pluriel(vivants.length, 'personne', 'personnes')} de cette histoire ${
        vivants.length > 1 ? 'sont' : 'est'
      } encore là.`,
      regarde: vivants,
      montre: new Set(vivants),
    });
  }

  // ── VII. Le carton final ───────────────────────────────────────────────
  actes.push({
    kind: 'final',
    duree: DUREE_FINAL,
    titre: graph.title,
    sous:
      gapCount > 0
        ? `${pluriel(gapCount, 'case reste', 'cases restent')} à remplir. La suite s’écrit à plusieurs.`
        : 'La suite s’écrit à plusieurs.',
  });

  return {
    actes,
    duree: actes.reduce((total, acte) => total + acte.duree, 0),
    titre: graph.title,
    de,
    a,
  };
}

/** L'acte qui court à un instant donné, et où l'on en est dedans. */
export function acteA(scenario: Scenario, t: number): { index: number; acte: Acte; local: number } {
  let debut = 0;
  for (let i = 0; i < scenario.actes.length; i += 1) {
    const acte = scenario.actes[i];
    if (t < debut + acte.duree || i === scenario.actes.length - 1) {
      return { index: i, acte, local: Math.max(0, Math.min(acte.duree, t - debut)) };
    }
    debut += acte.duree;
  }
  const dernier = scenario.actes.length - 1;
  return { index: dernier, acte: scenario.actes[dernier], local: 0 };
}

/** L'instant où commence un acte, pour se déplacer dans le film. */
export function debutDe(scenario: Scenario, index: number): number {
  let debut = 0;
  for (let i = 0; i < index && i < scenario.actes.length; i += 1) debut += scenario.actes[i].duree;
  return debut;
}

/**
 * QUI EST DESSINÉ, À CET INSTANT PRÉCIS.
 *
 * Pour tous les actes sauf la croissance, c'est le `montre` de l'acte : un
 * ensemble figé. La croissance, elle, se DÉCOUVRE — c'est tout son sujet :
 * les générations entrent l'une après l'autre à mesure que le plan avance.
 *
 * Rendu ici plutôt que dans la vue parce que c'est du montage, pas du dessin :
 * la question « qui a déjà poussé à la moitié du plan » se répond avec le
 * scénario en main, pas avec un canevas.
 */
export function montreA(
  acte: Acte,
  local: number,
  layout: TreeLayout,
): Set<string> | null {
  if (acte.kind !== 'pousse') return acte.montre ?? null;
  if (!acte.rangees || acte.rangees.length === 0) return null;

  /*
   * La progression s'achève aux quatre cinquièmes du plan : l'arbre complet
   * doit rester un instant à l'écran avant la coupe. Un mouvement qui finit
   * exactement quand le plan finit ne se lit pas — on n'en garde que
   * l'impression d'avoir raté quelque chose.
   */
  const avance = Math.max(0, Math.min(1, local / (acte.duree * 0.8)));
  const jusqua = Math.ceil(avance * acte.rangees.length);
  const generations = new Set(acte.rangees.slice(0, Math.max(1, jusqua)).map((r) => r.generation));

  const montre = new Set<string>();
  for (const [id, position] of layout.positions) {
    if (generations.has(position.generation)) montre.add(id);
  }
  return montre;
}
