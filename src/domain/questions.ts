import type { FamilyGraph } from './graph';
import { findGaps, type Gap, type GapKind } from './gaps';

/* ═══════════════════════════════════════════════════════════════════════════
 * LES QUESTIONS À POSER
 *
 * Un arbre généalogique ne se remplit pas en cherchant : il se remplit en
 * DEMANDANT À QUELQU'UN.
 *
 * ── CE QUE « À COMPLÉTER » NE DIT PAS ────────────────────────────────────
 *
 * La vue des manques relève des champs vides et les range par importance.
 * C'est juste, et parfaitement inerte : « lieu de naissance manquant pour
 * François Albertini » ne dit pas quoi faire de cette phrase. Personne ne se
 * lève pour aller consulter un registre — mais tout le monde peut envoyer un
 * message à sa tante.
 *
 * Ce fichier prend les mêmes manques et répond à la seule question qui
 * déclenche quelque chose : À QUI DEMANDER. Rien de neuf n'est calculé sur la
 * famille ; c'est le même relevé, tourné du côté de l'action.
 *
 * ── LA RÈGLE DE ROUTAGE ──────────────────────────────────────────────────
 *
 * Le plus proche parent VIVANT, en partant de la personne concernée : elle
 * d'abord si elle est là — nul ne connaît mieux sa propre date de naissance —
 * puis de proche en proche par les parents, les enfants, la fratrie et les
 * conjoints.
 *
 * Un parcours en largeur, donc, et pas une liste de priorités écrite à la
 * main : « l'enfant plutôt que le neveu » est vrai dans la plupart des cas et
 * faux dès qu'il n'y a pas d'enfant. La distance dans le graphe le dit
 * toujours, et sans qu'on ait à énumérer les cas.
 *
 * ── POURQUOI DES GROUPES NOMINAUX, ET PAS DES QUESTIONS ──────────────────
 *
 * « Où es-tu né ? » ou « Où êtes-vous né ? » — il faut choisir, et l'on se
 * trompera pour la moitié de la famille. Une petite-fille tutoie sa
 * grand-mère, un cousin par alliance ne la tutoie pas. « Le lieu de naissance
 * de Françoise » ne prend parti sur rien, se lit aussi bien dans un message
 * que sur un écran, et reste juste que l'on s'adresse à la personne concernée
 * ou à quelqu'un d'autre.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface Question {
  /** L'identifiant du manque d'origine — c'est lui qui porte le suivi. */
  gapId: string;
  /** De qui l'on parle. */
  sujetId: string;
  /** Ce qu'on demande, en toutes lettres — pour l'écran. */
  texte: string;
  /**
   * La personne à qui l'on demande est CELLE DONT ON PARLE.
   *
   * C'est le cas le plus fréquent, et de loin : nul ne connaît mieux sa
   * propre date de naissance. Mais il ne se rédige pas comme les autres —
   * « Bonjour Adrien, il nous manque les parents d'Adrien Noël » est le genre
   * de phrase qui fait fermer un message.
   */
  pourSoi: boolean;
}

export interface Interlocuteur {
  /** Qui interroger. `null` quand personne de vivant n'est rattaché. */
  id: string | null;
  nom: string;
  /**
   * À quelle distance de parenté il se trouve des gens dont il est question,
   * au plus près. Sert à ranger : on commence par ceux qui savent de
   * première main.
   */
  proximite: number;
  questions: Question[];
}

/**
 * Ce qu'on cherche, formulé pour un message.
 *
 * Presque tout tient en groupe nominal — « le lieu de naissance de X » — et
 * n'a donc aucun accord à faire. La seule exception demande le genre : « avec
 * qui X s'est marié » ne s'écrit pas pareil selon la personne, et l'accord
 * manquant se verrait dans un message envoyé à sa grand-mère.
 */
/**
 * Les mêmes demandes, adressées à la personne concernée.
 *
 * Au VOUVOIEMENT, et c'est un choix. Il faut trancher — une petite-fille
 * tutoie sa grand-mère, un cousin par alliance ne la tutoie pas — et des deux
 * erreurs possibles, celle-ci est la seule qui ne blesse personne. Le message
 * est de toute façon collé dans une conversation avant d'être envoyé : qui
 * tutoie corrigera en trois secondes, l'inverse aurait été plus gênant.
 */
const DEMANDE_SOI: Record<GapKind, (genre?: string) => string> = {
  parents: () => 'le nom de vos parents',
  father: () => 'le nom de votre père',
  mother: () => 'le nom de votre mère',
  birthDate: () => 'votre date de naissance',
  birthPlace: () => 'votre lieu de naissance',
  /* Une fiche de décès ne concerne jamais quelqu'un de vivant : ces deux
     lignes ne peuvent pas être atteintes, et n'existent que pour que la table
     reste complète plutôt que d'imposer un cas particulier à la lecture. */
  deathDate: () => 'la date du décès',
  deathPlace: () => 'le lieu du décès',
  spouse: (genre) =>
    `avec qui vous vous êtes marié${genre === 'f' ? 'e' : genre === 'm' ? '' : '(e)'}`,
};

/**
 * « de Éliane » ne s'écrit pas.
 *
 * L'élision devant voyelle, qu'on n'aurait pas remarquée en relisant du code
 * et qui saute aux yeux dans un message qu'on s'apprête à envoyer à sa
 * grand-tante.
 *
 * Les voyelles SEULEMENT, jamais le h. « d'Henriette » est plus élégant, mais
 * le français distingue un h muet d'un h aspiré sans qu'aucune règle ne
 * permette de trancher sur un prénom : « de Hugues » est correct, « d'Hugues »
 * ne l'est pas. Devant une voyelle, en revanche, il n'y a pas de cas
 * particulier — et « de Henriette » ne choque personne.
 */
const VOYELLES = /^[aàâäeéèêëiîïoôöuùûüyAÀÂÄEÉÈÊËIÎÏOÔÖUÙÛÜY]/;
const de = (nom: string): string => (VOYELLES.test(nom) ? `d’${nom}` : `de ${nom}`);

const DEMANDE: Record<GapKind, (nom: string, genre?: string) => string> = {
  parents: (nom) => `les parents ${de(nom)}`,
  father: (nom) => `le père ${de(nom)}`,
  mother: (nom) => `la mère ${de(nom)}`,
  birthDate: (nom) => `la date de naissance ${de(nom)}`,
  birthPlace: (nom) => `le lieu de naissance ${de(nom)}`,
  deathDate: (nom) => `la date du décès ${de(nom)}`,
  deathPlace: (nom) => `le lieu du décès ${de(nom)}`,
  spouse: (nom, genre) =>
    `avec qui ${nom} s’est marié${genre === 'f' ? 'e' : genre === 'm' ? '' : '(e)'}`,
};

/**
 * Le plus proche parent vivant, en partant de `depart`.
 *
 * Rend aussi la distance, qui sert à ranger les interlocuteurs : quelqu'un
 * qu'on interroge sur lui-même (distance 0) sait mieux que son petit-neveu
 * (distance 3), et la liste doit commencer par là.
 *
 * La recherche traverse les morts sans s'y arrêter — c'est justement par eux
 * que passent les branches dont on cherche à savoir quelque chose.
 */
function plusProcheVivant(
  graph: FamilyGraph,
  depart: string,
  exclus: Set<string>,
): { id: string; distance: number } | null {
  const vus = new Set<string>([depart]);
  let front: string[] = [depart];
  let distance = 0;

  while (front.length > 0 && distance <= 4) {
    for (const id of front) {
      const person = graph.people.get(id);
      if (person?.living && !exclus.has(id)) return { id, distance };
    }

    const suivant: string[] = [];
    for (const id of front) {
      const person = graph.people.get(id);
      if (!person) continue;
      const voisins = [
        ...person.parents,
        ...person.children,
        ...person.siblings,
        ...person.spouseLinks.map((link) => link.id),
      ];
      for (const voisin of voisins) {
        if (vus.has(voisin) || !graph.people.has(voisin)) continue;
        vus.add(voisin);
        suivant.push(voisin);
      }
    }
    front = suivant;
    distance += 1;
  }

  return null;
}

export interface OptionsQuestions {
  /**
   * Celui qui regarde, s'il s'est désigné dans l'arbre.
   *
   * On ne se propose pas à soi-même de s'écrire un message. Ses propres
   * manques lui reviennent dans un groupe à part, que la vue nomme
   * autrement — c'est la seule liste où il n'y a personne à attendre.
   */
  moi?: string | null;
}

/**
 * Les manques du périmètre, rangés par personne à qui les poser.
 *
 * `gaps` peut être fourni pour éviter de relever deux fois les mêmes manques
 * quand la vue les a déjà sous la main.
 */
export function questionsAPoser(
  graph: FamilyGraph,
  scope: Iterable<string>,
  options: OptionsQuestions = {},
  gaps?: Gap[],
): Interlocuteur[] {
  const releve = gaps ?? findGaps(graph, scope);
  const groupes = new Map<string, Interlocuteur>();

  for (const gap of releve) {
    const sujet = graph.people.get(gap.personId);
    if (!sujet) continue;

    /*
     * On ne s'interroge pas soi-même — mais on ne jette pas la question pour
     * autant : elle part vers le parent vivant suivant. C'est à ça que sert
     * `exclus` : dire « pas celui-là » sans dire « pas du tout ».
     */
    const exclus = new Set<string>();
    if (options.moi) exclus.add(options.moi);

    const trouve = plusProcheVivant(graph, gap.personId, exclus);
    const cle = trouve?.id ?? '∅';

    let groupe = groupes.get(cle);
    if (!groupe) {
      groupe = {
        id: trouve?.id ?? null,
        nom: trouve ? (graph.people.get(trouve.id)?.displayName ?? trouve.id) : 'Personne à qui demander',
        proximite: trouve?.distance ?? 99,
        questions: [],
      };
      groupes.set(cle, groupe);
    }
    groupe.proximite = Math.min(groupe.proximite, trouve?.distance ?? 99);
    groupe.questions.push({
      gapId: gap.id,
      sujetId: gap.personId,
      texte: DEMANDE[gap.kind](sujet.displayName, sujet.gender),
      pourSoi: trouve?.id === gap.personId,
    });
  }

  /*
   * D'ABORD CEUX À QUI L'ON A LE PLUS À DEMANDER.
   *
   * Le premier rangement mettait la proximité devant, et la liste commençait
   * donc par une file de groupes à UNE question — chacun étant son propre
   * meilleur informateur sur ses propres parents. Vérifié sur la
   * démonstration : douze groupes d'une seule ligne, et rien de substantiel
   * avant d'avoir tout fait défiler.
   *
   * Une personne à qui l'on doit demander six choses vaut un message ; une
   * personne à qui l'on en doit une peut attendre la prochaine fois qu'on la
   * croise. La proximité ne départage plus qu'à nombre égal.
   */
  return [...groupes.values()].sort(
    (a, b) =>
      (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0) ||
      b.questions.length - a.questions.length ||
      a.proximite - b.proximite ||
      a.nom.localeCompare(b.nom),
  );
}

/**
 * Le message tout prêt, à coller dans un SMS ou un courriel.
 *
 * C'est LA raison d'être de cette vue. Une liste qu'on peut lire ne fait rien
 * arriver ; une liste qu'on peut envoyer, si. Le texte est délibérément court
 * et sans formule : celui qui l'envoie ajoutera la sienne, et une politesse
 * écrite par une application se reconnaît à dix mètres.
 */
export function messagePour(
  interlocuteur: Interlocuteur,
  titreFamille: string,
  graph?: FamilyGraph,
): string {
  const prenom = interlocuteur.nom.split(' ')[0];
  const entete =
    interlocuteur.questions.length > 1
      ? `Bonjour ${prenom}, on complète l’arbre de la famille ${titreFamille} et il nous manque :`
      : `Bonjour ${prenom}, on complète l’arbre de la famille ${titreFamille} et il nous manque une chose :`;

  const lignes = interlocuteur.questions.map((question) => {
    /* Le genre de manque est le suffixe de l'identifiant du relevé (voir
       `findGaps`) : on le relit plutôt que de le recopier dans la question,
       ce qui aurait fait deux sources à tenir d'accord. */
    const kind = question.gapId.slice(question.gapId.lastIndexOf(':') + 1) as GapKind;
    if (question.pourSoi && kind in DEMANDE_SOI) {
      return `— ${DEMANDE_SOI[kind](graph?.people.get(question.sujetId)?.gender)}`;
    }
    return `— ${question.texte}`;
  });

  return [entete, '', ...lignes].join('\n');
}
