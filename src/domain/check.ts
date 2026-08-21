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
