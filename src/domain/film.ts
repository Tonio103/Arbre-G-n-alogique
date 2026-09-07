import type { FamilyGraph } from './graph';
import type { GenerationRow, TreeLayout } from './layout';
import { collectScopedPlaces, type ScopedPlace } from './places';

/* ═══════════════════════════════════════════════════════════════════════════
 * LE SCÉNARIO
 *
 * Un film sur une famille, déduit de ses données — pas un montage écrit à la
 * main qui vaudrait pour une seule famille et mentirait sur toutes les autres.
 * Ce fichier ne dessine rien et n'anime rien : il RÉPOND aux questions dont un
 * film a besoin, dans l'ordre où il les pose.
 *
 * Le partage est délibéré. Ici, ce que la famille raconte ; dans `FilmView`,
 * comment on le montre. Un scénario qui saurait déplacer une caméra serait
 * intestable, et une caméra qui saurait lire un graphe généalogique
 * deviendrait impossible à relire.
 *
 * ── LA RÈGLE QUI GOUVERNE TOUT LE RESTE ──────────────────────────────────
 *
 * Aucun acte ne se joue s'il n'a rien à dire. Une famille sans lieu connu
 * n'aura pas d'acte des lieux ; une famille sans date n'aura pas de siècles à
 * traverser. Un film qui garderait ses chapitres vides pour tenir sa durée
 * afficherait « 0 lieu » en pleine page, ce qui est pire que de se taire.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ActeKind =
  | 'titre'
  | 'racines'
  | 'pousse'
  | 'lieux'
  | 'vivants'
  | 'final';

export interface Acte {
  kind: ActeKind;
  /** Durée du plan, en millisecondes. */
  duree: number;
  /** Le grand texte, composé au centre ou en bas selon l'acte. */
  titre?: string;
  /** La ligne de dessous : une précision, jamais une redite du titre. */
  sous?: string;
  /** Le millésime affiché en grand pendant l'acte, s'il en porte un. */
  annee?: number;
  /** Sur qui la caméra se pose. Le film y va, le scénario ne fait que le dire. */
  regarde?: string[];
  /** Rangée de génération visée, pour les actes qui descendent l'arbre. */
  rangee?: GenerationRow;
  /** Les lieux mis en avant, dans l'ordre où ils s'allument. */
  lieux?: ScopedPlace[];
  /** Le déplacement de la famille, génération après génération. */
  trajectoire?: Etape[];
}

/**
 * UNE ÉTAPE DU DÉPLACEMENT : le centre de gravité d'une génération.
 *
 * Le premier essai reliait les 39 lieux dans l'ordre de leur première date.
 * Le résultat, vérifié à l'écran, était une toile d'araignée en travers de la
 * France : des dates voisines n'impliquent aucune proximité géographique, et
 * relier deux lieux parce qu'ils se suivent dans le temps ne raconte rien.
 *
 * La moyenne des lieux de naissance d'une génération, elle, se déplace
 * vraiment — et c'est ce déplacement-là qu'on vient voir. Ce n'est pas un
 * endroit où quelqu'un a vécu, et le film ne le prétend pas : c'est un centre,
 * et un centre se lit comme tel.
 */
export interface Etape {
  generation: number;
  label: string;
  lat: number;
  lon: number;
  /** Combien de naissances situées ont formé cette moyenne. */
  compte: number;
}

export interface Scenario {
  actes: Acte[];
  duree: number;
  titre: string;
  /** Les bornes de l'histoire racontée. */
  de?: number;
  a?: number;
}

/** Le pluriel, sans le « (s) » des formulaires. */
function pluriel(n: number, singulier: string, pluriel_: string): string {
  return `${n} ${n > 1 ? pluriel_ : singulier}`;
}

/**
 * Les doyens : ceux dont on ne connaît pas les parents et qui portent la date
 * la plus ancienne.
 *
 * Pas simplement « la génération 0 » : dans un arbre importé, la génération la
 * plus ancienne peut ne contenir qu'une personne sans aucune date, arrivée là
 * par un lien mal saisi. On cherche donc une date, puis on remonte.
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
    // Une fenêtre d'une génération : les doyens sont une fratrie ou un couple,
    // pas une seule personne isolée dans le temps.
    if (person?.birthYear !== undefined && person.birthYear <= meilleure + 24) {
      doyens.push(id);
    }
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

const DUREE_TITRE = 4200;
const DUREE_RACINES = 5200;
const DUREE_RANGEE = 2600;
const DUREE_LIEUX = 6400;
const DUREE_VIVANTS = 4600;
const DUREE_FINAL = 5000;

/**
 * Le film d'une famille.
 *
 * `gapCount` n'est pas décoratif : le dernier carton n'est pas une signature
 * mais une invitation, et une invitation a besoin d'un nombre. C'est la seule
 * chose que le film demande à qui le regarde.
 */
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
  const etendue = de !== undefined && a !== undefined ? `${de} — ${a}` : undefined;
  actes.push({
    kind: 'titre',
    duree: DUREE_TITRE,
    titre: graph.title,
    sous: [
      pluriel(layout.positions.size, 'personne', 'personnes'),
      pluriel(layout.rows.length, 'génération', 'générations'),
      etendue,
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
        ? `Tout ce qu'on sait commence en ${premier.birthYear}${lieu ? `, à ${lieu}` : ''}.`
        : 'Tout ce qu’on sait commence ici.',
      annee: premier?.birthYear,
      regarde: doyens,
    });
  }

  // ── III. L'arbre pousse, rangée par rangée ─────────────────────────────
  /*
   * Une rangée, un plan. On saute la première : c'est celle des racines, on
   * vient de la regarder, et la revoir aussitôt ferait bégayer le film.
   */
  for (const rangee of layout.rows.slice(doyens.length > 0 ? 1 : 0)) {
    actes.push({
      kind: 'pousse',
      duree: DUREE_RANGEE,
      titre: rangee.label,
      sous: pluriel(rangee.count, 'personne', 'personnes'),
      rangee,
    });
  }

  // ── IV. Les lieux ──────────────────────────────────────────────────────
  const rapport = collectScopedPlaces(graph, layout.positions.keys());
  if (rapport.places.length >= 2) {
    /*
     * Dans l'ordre où la famille les a connus, pas par ordre d'importance :
     * c'est un déplacement qu'on raconte, et un déplacement a un sens. Les
     * lieux sans date attestée passent en dernier — on ne peut pas les situer
     * dans le mouvement sans l'inventer.
     */
    const ordonnes = [...rapport.places].sort(
      (x, y) => (x.earliestYear ?? 99999) - (y.earliestYear ?? 99999),
    );
    /*
     * Le centre de gravité de chaque génération, dans l'ordre.
     *
     * Seules les NAISSANCES entrent dans la moyenne : c'est le seul événement
     * qu'une personne ne choisit pas, et donc le seul qui dise où sa famille
     * se trouvait à ce moment-là. Un décès ou une résidence disent où elle est
     * allée, ce qui est une autre question.
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
      // en interpolant entre ses voisines dessinerait un déplacement qui n'a
      // jamais eu lieu.
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
          ? `De ${premier.label} à ${dernier.label} — ${pluriel(rapport.places.length, 'lieu', 'lieux')} en tout.`
          : `${pluriel(rapport.places.length, 'lieu', 'lieux')}.`,
      lieux: ordonnes,
      trajectoire: trajectoire.length >= 2 ? trajectoire : undefined,
    });
  }

  // ── V. Les vivants ─────────────────────────────────────────────────────
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
    });
  }

  // ── VI. Le carton final ────────────────────────────────────────────────
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
