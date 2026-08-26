import { parseYear } from './dates';
import type { FamilyGraph } from './graph';

/**
 * La relecture des données.
 *
 * Un arbre généalogique se saisit à la main, souvent sur des années, à partir
 * d'actes qu'on déchiffre mal. Les fautes de frappe y sont la règle : une date
 * à un chiffre près, un identifiant de parent recopié de travers, un enfant né
 * après la mort de sa mère. Rien de tout cela ne fait planter l'application —
 * et c'est bien le problème : l'erreur se dessine sans rien dire, et se
 * découvre des mois plus tard.
 *
 * Ce module relit l'arbre construit et signale ce qui ne peut pas être vrai.
 * Il ne corrige rien et ne bloque rien : un arbre réel contient des zones
 * douteuses qu'on assume, et c'est à la personne qui saisit de trancher.
 */

export type AnomalyLevel = 'erreur' | 'doute';

export interface Anomaly {
  level: AnomalyLevel;
  /** Personne concernée, quand l'anomalie en désigne une. */
  id?: string;
  message: string;
}

/** Âge minimal pour être parent ou se marier : en deçà, c'est une faute de saisie. */
const MIN_PARENT_AGE = 13;
const MIN_MARRIAGE_AGE = 14;
/** Doyenne officielle de l'humanité : 122 ans. Au-delà, c'est une date fausse. */
const MAX_LIFESPAN = 122;

const named = (graph: FamilyGraph, id: string): string => {
  const person = graph.people.get(id);
  return person ? `${person.firstName} ${person.lastName}` : id;
};

/**
 * Ce qui n'est relié à rien.
 *
 * Un lien de filiation ne se déclare que d'un côté — l'enfant nomme ses
 * parents — et il suffit qu'il manque là pour qu'une lignée entière se
 * détache, même si tout le reste de ses liens internes est intact. Elle
 * continue alors d'être dessinée, mais à côté de l'arbre, comme une famille
 * étrangère : rien à l'écran ne dit que c'est un oubli plutôt qu'un choix.
 *
 * On part donc du repère et on marche dans toutes les directions — parents,
 * enfants, conjoints. Ce qu'on n'atteint pas est signalé, groupé par îlot,
 * en nommant quelqu'un de chaque : c'est par cette personne-là qu'on ira
 * rebrancher la branche.
 */
function findDetached(graph: FamilyGraph): Anomaly[] {
  if (!graph.rootId || !graph.people.has(graph.rootId)) return [];

  const reachable = new Set<string>([graph.rootId]);
  const queue = [graph.rootId];
  while (queue.length > 0) {
    const person = graph.people.get(queue.shift()!);
    if (!person) continue;
    const neighbours = [
      ...person.parents,
      ...person.children,
      ...person.spouseLinks.map((link) => link.id),
    ];
    for (const id of neighbours) {
      if (reachable.has(id) || !graph.people.has(id)) continue;
      reachable.add(id);
      queue.push(id);
    }
  }

  // Regrouper les personnes hors d'atteinte en îlots, pour ne pas répéter le
  // même avertissement une fois par personne.
  const anomalies: Anomaly[] = [];
  const seen = new Set<string>();
  for (const id of graph.order) {
    if (reachable.has(id) || seen.has(id)) continue;
    const island: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      island.push(current);
      const person = graph.people.get(current);
      if (!person) continue;
      for (const other of [
        ...person.parents,
        ...person.children,
        ...person.spouseLinks.map((link) => link.id),
      ]) {
        if (seen.has(other) || !graph.people.has(other)) continue;
        seen.add(other);
        stack.push(other);
      }
    }

    const who = named(graph, island[0]);
    anomalies.push({
      level: 'erreur',
      id: island[0],
      message:
        island.length === 1
          ? `${who} n’est reliée à personne : ni parents, ni conjoint, ni enfants.`
          : `${who} et ${island.length - 1} autre${island.length > 2 ? 's' : ''} forment une branche détachée du reste de l’arbre — il manque un lien de filiation pour l’y rattacher.`,
    });
  }

  return anomalies;
}

/**
 * Relit l'arbre et rend la liste des invraisemblances.
 *
 * L'ordre est celui de la lecture : les anomalies structurelles d'abord — un
 * parent qui n'existe pas empêche de juger du reste — puis les dates.
 */
export function auditFamily(graph: FamilyGraph): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Ce que la construction du graphe a déjà relevé : références inconnues,
  // doublons, boucles de filiation.
  for (const message of graph.warnings) anomalies.push({ level: 'erreur', message });

  anomalies.push(...findDetached(graph));

  for (const id of graph.order) {
    const person = graph.people.get(id);
    if (!person) continue;
    const who = named(graph, id);
    const birth = person.birthYear;
    const death = person.deathYear;

    if (birth !== undefined && death !== undefined) {
      if (death < birth) {
        anomalies.push({
          level: 'erreur',
          id,
          message: `${who} : décès en ${death}, avant sa naissance en ${birth}.`,
        });
      } else if (death - birth > MAX_LIFESPAN) {
        anomalies.push({
          level: 'doute',
          id,
          message: `${who} aurait vécu ${death - birth} ans (${birth} – ${death}).`,
        });
      }
    }

    for (const childId of person.children) {
      const child = graph.people.get(childId);
      const childBirth = child?.birthYear;
      if (childBirth === undefined || birth === undefined) continue;

      if (childBirth - birth < MIN_PARENT_AGE) {
        anomalies.push({
          level: 'erreur',
          id,
          message:
            childBirth < birth
              ? `${who} (né en ${birth}) est déclaré parent de ${named(graph, childId)}, né avant lui en ${childBirth}.`
              : `${who} aurait eu ${childBirth - birth} ans à la naissance de ${named(graph, childId)}.`,
        });
      }

      // Un enfant posthume est possible — neuf mois, pas davantage.
      if (death !== undefined && childBirth > death + 1) {
        anomalies.push({
          level: 'erreur',
          id,
          message: `${named(graph, childId)} naît en ${childBirth}, soit ${childBirth - death} ans après la mort de ${who}.`,
        });
      }
    }

    for (const link of person.spouseLinks) {
      const year = parseYear(link.since);
      if (year === undefined) continue;
      if (birth !== undefined && year - birth < MIN_MARRIAGE_AGE) {
        anomalies.push({
          level: 'erreur',
          id,
          message:
            year < birth
              ? `${who} est marié·e en ${year}, avant sa naissance en ${birth}.`
              : `${who} aurait ${year - birth} ans à son mariage de ${year}.`,
        });
      }
      if (death !== undefined && year > death) {
        anomalies.push({
          level: 'erreur',
          id,
          message: `${who} est marié·e en ${year}, après son décès en ${death}.`,
        });
      }
    }
  }

  return anomalies;
}

/**
 * Écrit le rapport dans la console.
 *
 * Groupé, compté, et silencieux quand tout va bien : une console qui parle
 * pour ne rien dire finit par ne plus être lue.
 */
export function reportAnomalies(anomalies: Anomaly[]): void {
  if (anomalies.length === 0) return;
  const erreurs = anomalies.filter((a) => a.level === 'erreur');
  const doutes = anomalies.filter((a) => a.level === 'doute');

  const titre = `Arbre généalogique : ${erreurs.length} incohérence${
    erreurs.length > 1 ? 's' : ''
  }${doutes.length ? ` et ${doutes.length} point${doutes.length > 1 ? 's' : ''} douteux` : ''}`;

  console.groupCollapsed(titre);
  for (const anomaly of erreurs) console.warn(anomaly.message);
  for (const anomaly of doutes) console.info(anomaly.message);
  console.groupEnd();
}
