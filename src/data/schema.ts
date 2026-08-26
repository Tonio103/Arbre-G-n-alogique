/**
 * Schéma des données familiales.
 *
 * Principe : le fichier de données ne décrit que ce qui est *saisi* par un humain.
 * Les relations réciproques (enfants, fratrie, petits-enfants…) sont **dérivées**
 * au chargement par `buildFamilyGraph`, pour qu'il soit impossible d'introduire
 * une incohérence en oubliant de mettre à jour les deux côtés d'un lien.
 *
 * Pour ajouter quelqu'un : une entrée `PersonRecord` avec `parents` et/ou `spouses`.
 * Rien d'autre à toucher — aucun composant d'interface ne connaît vos ancêtres.
 */

/** Date historique tolérante : "1887", "1887-04", "1887-04-23", ou "vers 1887". */
export type HistoricalDate = string;

export type Gender = 'f' | 'm' | 'x';

export type UnionStatus =
  | 'married'
  | 'partner'
  | 'divorced'
  | 'widowed'
  | 'engaged'
  | 'unknown';

/** Lien vers un conjoint. La forme courte `"id"` équivaut à `{ id, status: 'married' }`. */
export interface SpouseLink {
  id: string;
  status?: UnionStatus;
  /** Date d'union (mariage, pacs, mise en ménage). */
  since?: HistoricalDate;
  /** Date de fin d'union le cas échéant (divorce). */
  until?: HistoricalDate;
  place?: string;
}

/** Événement marquant, affiché en frise dans le panneau de détails. */
export interface Milestone {
  year?: HistoricalDate;
  title: string;
  detail?: string;
}

/** Lien externe facultatif (acte d'état civil numérisé, article, arbre externe…). */
export interface ExternalLink {
  label: string;
  url: string;
}

/**
 * Une personne, telle qu'elle est saisie dans les fichiers de données.
 * Tous les champs sont facultatifs sauf l'identité minimale : l'arbre doit
 * accepter un ancêtre dont on ne connaît que le nom.
 */
export interface PersonRecord {
  id: string;
  firstName: string;
  lastName: string;

  /** Nom de naissance, quand il diffère du nom porté. */
  maidenName?: string;
  /** Second prénom / prénoms d'usage, affichés dans le détail seulement. */
  middleNames?: string;
  /** Surnom familial ; sert aussi de terme de recherche. */
  nickname?: string;
  gender?: Gender;

  birthDate?: HistoricalDate;
  birthPlace?: string;
  deathDate?: HistoricalDate;
  deathPlace?: string;

  /** URL ou chemin d'une vraie photo. Sans photo, un portrait est généré. */
  photo?: string;

  profession?: string;
  education?: string;
  /** Lieux de vie successifs. */
  residences?: string[];

  /** Une ligne très courte affichée sous le nom sur la carte (2–4 mots). */
  headline?: string;
  biography?: string;

  interests?: string[];
  anecdotes?: string[];
  milestones?: Milestone[];
  memories?: string[];
  notes?: string;
  links?: ExternalLink[];

  /**
   * Champs libres, pour tout ce que ce schéma n'a pas prévu.
   * Ils s'affichent automatiquement dans le panneau de détails.
   * Ex. `{ "Service militaire": "7e régiment de tirailleurs, 1917-1919" }`
   */
  custom?: Record<string, string | string[]>;

  /**
   * Identifiants des parents. Source de vérité de la filiation.
   *
   * Deux le plus souvent, mais rien ne l'impose : une adoption, une
   * reconnaissance ou une famille recomposée en donnent trois ou quatre à un
   * même enfant, et les inscrire tous vaut mieux que de choisir lesquels
   * comptent.
   */
  parents?: string[];
  /** Conjoints. Le lien est symétrisé automatiquement. */
  spouses?: Array<string | SpouseLink>;
}

/** Union normalisée : un couple (ou un parent seul) et ses enfants. */
export interface Union {
  id: string;
  /** 1 ou 2 partenaires. Un seul = parent isolé ou lignée dont l'autre parent est inconnu. */
  partners: string[];
  children: string[];
  status: UnionStatus;
  since?: HistoricalDate;
  until?: HistoricalDate;
  place?: string;
}

/** Personne enrichie : le record d'origine + toutes les relations dérivées. */
export interface Person extends PersonRecord {
  /** Toujours défini après normalisation. */
  parents: string[];
  children: string[];
  /** Frères et sœurs partageant au moins un parent, ordonnés par naissance. */
  siblings: string[];
  /** Demi-frères et demi-sœurs (un seul parent commun). */
  halfSiblings: string[];
  spouseLinks: SpouseLink[];
  /** Unions auxquelles la personne participe en tant que partenaire. */
  unionIds: string[];
  /** Union dont la personne est issue, si ses parents sont connus. */
  originUnionId?: string;

  /** Profondeur générationnelle, 0 = ancêtres les plus anciens connus. */
  generation: number;
  displayName: string;
  /** Nom de naissance affiché entre parenthèses le cas échéant. */
  birthName?: string;
  initials: string;
  /** Année de naissance numérique, pour tris et frises. `undefined` si inconnue. */
  birthYear?: number;
  deathYear?: number;
  /** `true` si la personne est présumée vivante (aucune date de décès connue). */
  living: boolean;
  ageAtDeath?: number;
  /** Nom complet normalisé (sans accents, minuscules) : base du classement. */
  nameKey: string;
  /** Tous les termes recherchables, normalisés : nom, surnom, métier, lieu. */
  searchKey: string;
}

/**
 * Nom donné à une portion de l'arbre. En vue éloignée, l'étendue occupée par
 * la descendance de `anchorId` est signalée par ce libellé — sans quoi un
 * grand arbre dézoomé n'est qu'un nuage de points sans repères.
 */
export interface BranchAnchor {
  label: string;
  anchorId: string;
}

export interface FamilyDataset {
  /** Nom affiché dans la barre supérieure. */
  title: string;
  subtitle?: string;
  /** Personne affichée au démarrage et cible du bouton « Accueil ». */
  rootId: string;
  people: PersonRecord[];
  branches?: BranchAnchor[];
}
