import type { FamilyGraph } from './graph';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  COUPLE_GAP,
  FAMILY_GAP,
  ROW_HEIGHT,
  SIBLING_GAP,
  cardBottom,
  cardCenterX,
  cardTop,
  portraitCenterY,
  portraitTop,
} from '@/view/metrics';

export interface NodePosition {
  id: string;
  x: number;
  y: number;
  generation: number;
}

export interface LayoutPartner {
  id: string;
  x: number;
  y: number;
}

export interface LayoutUnion {
  id: string;
  partners: LayoutPartner[];
  children: LayoutPartner[];
  /** Point d'où part la descendance. */
  anchorX: number;
  anchorY: number;
  /** Vrai quand les deux conjoints sont côte à côte (cas courant). */
  adjacent: boolean;
  status: string;
}

/** Mariage reliant deux branches éloignées : dessiné en courbe pointillée. */
export interface CrossLink {
  id: string;
  a: LayoutPartner;
  b: LayoutPartner;
  status: string;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GenerationRow {
  generation: number;
  y: number;
  count: number;
  /** Décennie médiane des naissances, pour étiqueter la frise. */
  label: string;
}

/** Étendue occupée par une branche nommée, pour l'étiqueter en vue éloignée. */
export interface LayoutRegion {
  label: string;
  anchorId: string;
  minX: number;
  maxX: number;
  centerX: number;
  /** Haut de la région : la génération de l'ancêtre qui lui donne son nom. */
  y: number;
  count: number;
}

export interface TreeLayout {
  positions: Map<string, NodePosition>;
  regions: LayoutRegion[];
  /** Nombre de descendants de chaque personne. */
  weights: Map<string, number>;
  unions: LayoutUnion[];
  crossLinks: CrossLink[];
  bounds: Bounds;
  rows: GenerationRow[];
  /** Ordre de dessin des liens : les unions d'abord, indexées par personne. */
  unionsByPerson: Map<string, string[]>;
  unionById: Map<string, LayoutUnion>;
  /**
   * Lignée fondatrice de chaque personne, par son rang dans `graph.branches`.
   *
   * C'est ce qui donne sa couleur à une carte. Un diagramme monochrome de cinq
   * cents personnes ne laisse voir aucune structure : on ne distingue une
   * famille d'une autre qu'en suivant les traits un par un. Une teinte par
   * lignée rend cette structure lisible d'un seul regard, sans rien ajouter au
   * dessin.
   */
  branchOf: Map<string, number>;
}

/**
 * Un bloc : un couple côte à côte, ou une personne seule.
 *
 * L'ascendance de chaque membre se rattache **au-dessus** de lui, la
 * descendance du couple **en dessous**. C'est ce qui distingue ce placement
 * d'un simple arbre de descendance : un conjoint qui a lui-même des parents
 * connus n'a plus à choisir entre « rester près de son conjoint » et
 * « rester sous ses parents », puisque les deux tiennent enfin ensemble.
 */
interface PlacementNode {
  anchorId: string;
  /** Personnes du bloc, de gauche à droite (conjoints inclus). */
  members: string[];
  /**
   * Sous-arbres d'ascendance, un par membre qui en a une.
   *
   * `memberIndex` dit au-dessus de quel membre du bloc cette lignée doit se
   * centrer : celle de la personne de gauche reste à gauche, celle de droite
   * à droite. Les centrer toutes sur le bloc entier les empilerait au même
   * endroit, l'une par-dessus l'autre.
   */
  ancestorNodes: Array<PlacementNode & { memberIndex?: number }>;
  /** Sous-arbres de descendance, dans l'ordre des naissances. */
  childNodes: PlacementNode[];
  generation: number;
  blockWidth: number;
  /** Décalage de ce sous-arbre par rapport à l'origine de son parent. */
  offset: number;
  /**
   * Étendue horizontale occupée par ce sous-arbre, génération par génération.
   *
   * Indexée par génération absolue plutôt que par profondeur relative : un
   * sous-arbre s'étend maintenant vers le haut *et* vers le bas, et une
   * profondeur relative n'a plus de signe unique.
   */
  profile: Profile;
}

/** Étendue horizontale d'une génération : de `min` à `max`. */
interface Span {
  min: number;
  max: number;
}

type Profile = Map<number, Span>;

/** Fusionne `source`, décalée de `shift`, dans `target`. */
function mergeProfile(target: Profile, source: Profile, shift: number): void {
  for (const [generation, span] of source) {
    const existing = target.get(generation);
    const min = span.min + shift;
    const max = span.max + shift;
    if (existing) {
      existing.min = Math.min(existing.min, min);
      existing.max = Math.max(existing.max, max);
    } else {
      target.set(generation, { min, max });
    }
  }
}

/** Étendue totale d'un profil, toutes générations confondues. */
function profileSpan(profile: Profile): Span {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const span of profile.values()) {
    min = Math.min(min, span.min);
    max = Math.max(max, span.max);
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0 };
  return { min, max };
}

/**
 * Range une série de sous-arbres côte à côte, au plus serré.
 *
 * Chacun se décale juste assez pour ne toucher aucun de ses prédécesseurs, en
 * ne comparant que les générations qu'ils ont réellement en commun : une
 * branche courte peut ainsi se glisser sous la ramure de sa voisine au lieu
 * de la pousser, et la largeur totale reste celle de la génération la plus
 * fournie plutôt que celle du nombre de feuilles.
 */
function packGroup(nodes: PlacementNode[]): Profile {
  const merged: Profile = new Map();
  for (const node of nodes) {
    let shift = 0;
    for (const [generation, span] of node.profile) {
      const taken = merged.get(generation);
      if (!taken) continue;
      shift = Math.max(shift, taken.max - span.min + SIBLING_GAP);
    }
    node.offset = shift;
    mergeProfile(merged, node.profile, shift);
  }
  return merged;
}

/**
 * Même rangement, mais en partant d'un encombrement déjà connu et en
 * conservant la position souhaitée de chaque sous-arbre tant qu'elle ne
 * heurte rien.
 *
 * L'ascendance ne se range pas comme une fratrie : chaque lignée vise le
 * membre dont elle descend, et ne s'écarte de cette place que si elle
 * empiète sur quelque chose de déjà posé — le bloc lui-même, ou la lignée
 * de l'autre conjoint. Sans cette réserve, une lignée pouvait se retrouver
 * exactement sur les cartes du bloc parent, une génération plus haut.
 */
function packGroupFrom(
  nodes: Array<PlacementNode & { memberIndex?: number }>,
  occupied: Profile,
): Profile {
  const merged: Profile = new Map();
  mergeProfile(merged, occupied, 0);

  const added: Profile = new Map();
  for (const node of nodes) {
    let shift = 0;
    for (const [generation, span] of node.profile) {
      const taken = merged.get(generation);
      if (!taken) continue;
      const min = span.min + node.offset;
      const max = span.max + node.offset;
      // Ne pousser que s'il y a réellement recouvrement.
      if (max + SIBLING_GAP <= taken.min || min >= taken.max + SIBLING_GAP) continue;
      shift = Math.max(shift, taken.max - min + SIBLING_GAP);
    }
    node.offset += shift;
    mergeProfile(merged, node.profile, node.offset);
    mergeProfile(added, node.profile, node.offset);
  }
  return added;
}

/**
 * Place chaque personne une seule fois.
 *
 * Le parcours descend depuis les plus anciens ancêtres connus, comme se lit
 * un arbre imprimé. Ce qui change, c'est qu'un conjoint qui a lui-même des
 * parents peut désormais rejoindre le bloc de son époux ou son épouse : son
 * ascendance le suit et se place au-dessus de lui (`ancestorNodes`).
 *
 * Partir du repère de l'arbre plutôt que des ancêtres serait tentant — c'est
 * autour de lui que tout s'organise — mais le ferait devenir le sommet de sa
 * propre famille : ses frères et sœurs, rattachés à leurs parents un cran
 * plus haut, se retrouveraient placés exactement sur lui.
 */
function buildPlacementForest(graph: FamilyGraph): {
  roots: PlacementNode[];
  /** À quel bloc appartient chaque personne — un couple se déplace d'un seul tenant. */
  blockOf: Map<string, string>;
} {
  const { people, unions } = graph;
  const placed = new Set<string>();
  const placedUnions = new Set<string>();
  const roots: PlacementNode[] = [];
  const blockOf = new Map<string, string>();

  // Nombre de descendants, par programmation dynamique : `graph.order` étant trié
  // par génération, le parcourir à l'envers garantit que les enfants sont comptés
  // avant leurs parents.
  const descendantCount = new Map<string, number>();
  for (let i = graph.order.length - 1; i >= 0; i -= 1) {
    const id = graph.order[i];
    let total = 0;
    for (const childId of people.get(id)?.children ?? []) {
      total += 1 + (descendantCount.get(childId) ?? 0);
    }
    descendantCount.set(id, total);
  }

  const makeNode = (anchorId: string): PlacementNode => {
    placed.add(anchorId);
    const person = people.get(anchorId)!;

    /*
     * Les conjoints rejoignent le bloc, y compris ceux qui ont eux-mêmes des
     * parents dans l'arbre — c'est le changement décisif. Auparavant un tel
     * conjoint restait dans sa propre lignée, à l'autre bout de l'arbre, et
     * son mariage se réduisait à un pointillé qui traversait tout l'écran :
     * avec quelques générations de chaque côté, plus rien ne se lisait comme
     * une famille. Son ascendance étant désormais placée au-dessus de lui,
     * il peut enfin tenir sa place auprès de son conjoint.
     */
    const attachedSpouses: string[] = [];
    for (const unionId of person.unionIds) {
      const union = unions.get(unionId);
      if (!union) continue;
      const partnerId = union.partners.find((p) => p !== anchorId);
      if (!partnerId) continue;
      if (placed.has(partnerId)) continue;
      placed.add(partnerId);
      attachedSpouses.push(partnerId);
    }

    // Un seul conjoint : à droite. Plusieurs : encadrent l'ancre.
    let members: string[];
    if (attachedSpouses.length === 0) {
      members = [anchorId];
    } else if (attachedSpouses.length === 1) {
      members = [anchorId, attachedSpouses[0]];
    } else {
      members = [attachedSpouses[0], anchorId, ...attachedSpouses.slice(1)];
    }

    for (const memberId of members) blockOf.set(memberId, anchorId);

    const node: PlacementNode = {
      anchorId,
      members,
      ancestorNodes: [],
      childNodes: [],
      generation: person.generation,
      blockWidth: members.length * CARD_WIDTH + (members.length - 1) * COUPLE_GAP,
      offset: 0,
      profile: new Map(),
    };

    // L'ascendance de chaque membre, dans l'ordre où les membres sont posés :
    // la lignée de celui de gauche reste à gauche, celle de droite à droite,
    // et les deux branches ne se croisent pas au-dessus du couple.
    members.forEach((memberId, memberIndex) => {
      const member = people.get(memberId);
      if (!member) return;
      const parents = member.parents.filter((id) => people.has(id) && !placed.has(id));
      if (parents.length === 0) return;
      const ancestor = makeNode(parents[0]) as PlacementNode & { memberIndex?: number };
      ancestor.memberIndex = memberIndex;
      node.ancestorNodes.push(ancestor);
    });

    // Descendance : toute union d'un membre du bloc que personne n'a encore
    // prise en charge. La première visite emporte les enfants, ce qui garantit
    // qu'aucun enfant n'est oublié même quand ses parents sont dans deux branches.
    const relevantUnions: string[] = [];
    for (const memberId of members) {
      for (const unionId of people.get(memberId)?.unionIds ?? []) {
        if (!unions.has(unionId)) continue;
        if (placedUnions.has(unionId) || relevantUnions.includes(unionId)) continue;
        relevantUnions.push(unionId);
      }
    }

    for (const unionId of relevantUnions) {
      const union = unions.get(unionId)!;
      placedUnions.add(unionId);
      for (const childId of union.children) {
        if (placed.has(childId)) continue;
        node.childNodes.push(makeNode(childId));
      }
    }

    return node;
  };

  // Racines : les plus anciennes générations d'abord, les lignées les plus
  // fournies en tête, pour que l'arbre principal soit dessiné en premier.
  const candidates = [...graph.order].sort((a, b) => {
    const pa = people.get(a)!;
    const pb = people.get(b)!;
    const rootA = pa.parents.length === 0 ? 0 : 1;
    const rootB = pb.parents.length === 0 ? 0 : 1;
    if (rootA !== rootB) return rootA - rootB;
    if (pa.generation !== pb.generation) return pa.generation - pb.generation;
    const da = descendantCount.get(a) ?? 0;
    const db = descendantCount.get(b) ?? 0;
    if (da !== db) return db - da;
    return a.localeCompare(b);
  });

  for (const id of candidates) {
    if (placed.has(id)) continue;
    roots.push(makeNode(id));
  }

  return { roots, blockOf };
}

/**
 * Dernier mot sur les recouvrements.
 *
 * Le placement récursif range chaque sous-arbre par rapport à ses voisins
 * immédiats, mais deux branches très éloignées dans la récursion peuvent
 * malgré tout se retrouver à la même hauteur, au même endroit : la lignée
 * d'un conjoint remonte à une génération déjà occupée par une famille dont
 * elle ne sait rien. Aucun réglage local ne peut le garantir.
 *
 * Cette passe balaie donc chaque génération de gauche à droite et écarte ce
 * qui se chevauche, en déplaçant les couples d'un seul tenant. Elle ne
 * réordonne rien — l'ordre issu du placement, qui regroupe les familles,
 * est conservé — elle ne fait que garantir qu'aucune carte n'en recouvre
 * une autre.
 */
/** Regroupe les personnes par génération puis par bloc — la maille sur
 *  laquelle travaillent l'écartement et le recentrage. */
function groupByGeneration(
  positions: Map<string, NodePosition>,
  blockOf: Map<string, string>,
): Map<number, NodePosition[][]> {
  const byGeneration = new Map<number, Map<string, NodePosition[]>>();
  for (const position of positions.values()) {
    const generation = byGeneration.get(position.generation) ?? new Map<string, NodePosition[]>();
    const key = blockOf.get(position.id) ?? position.id;
    const group = generation.get(key) ?? [];
    group.push(position);
    generation.set(key, group);
    byGeneration.set(position.generation, generation);
  }

  const result = new Map<number, NodePosition[][]>();
  for (const [generation, blocks] of byGeneration) {
    result.set(
      generation,
      [...blocks.values()].map((members) => members.sort((a, b) => a.x - b.x)),
    );
  }
  return result;
}

/**
 * Écarte, sur une seule rangée, les blocs qui se chevauchent.
 *
 * L'ordre du tableau fait foi et n'est jamais remis en cause : c'est celui
 * qu'`orderRows` a choisi pour croiser le moins de traits possible. Trier à
 * nouveau par position defferait ce choix dès qu'un bloc dépasse son voisin
 * en cherchant son centre.
 */
function spreadRow(blocks: NodePosition[][]): void {
  let cursor = Number.NEGATIVE_INFINITY;
  for (const members of blocks) {
    const min = Math.min(...members.map((m) => m.x));
    if (min < cursor) {
      const shift = cursor - min;
      for (const member of members) member.x += shift;
    }
    cursor = Math.max(...members.map((m) => m.x)) + CARD_WIDTH + SIBLING_GAP;
  }
}

/** Milieu d'une rangée entière, du bord gauche du premier bloc au bord droit
 *  du dernier — sert à annuler la dérive de `spreadRow`. */
function rowCenter(blocks: NodePosition[][]): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const members of blocks) {
    for (const member of members) {
      min = Math.min(min, member.x);
      max = Math.max(max, member.x + CARD_WIDTH);
    }
  }
  return Number.isFinite(min) ? (min + max) / 2 : 0;
}

/** Remet les blocs d'une rangée dans l'ordre de leur position courante. */
function sortRowByPosition(blocks: NodePosition[][]): void {
  blocks.sort((a, b) => Math.min(...a.map((m) => m.x)) - Math.min(...b.map((m) => m.x)));
}

/**
 * Dernier mot sur les recouvrements.
 *
 * Le placement récursif range chaque sous-arbre par rapport à ses voisins
 * immédiats, mais deux branches très éloignées dans la récursion peuvent
 * malgré tout se retrouver à la même hauteur, au même endroit : la lignée
 * d'un conjoint remonte à une génération déjà occupée par une famille dont
 * elle ne sait rien. Aucun réglage local ne peut le garantir.
 *
 * Cette passe balaie donc chaque génération de gauche à droite et écarte ce
 * qui se chevauche, en déplaçant les couples d'un seul tenant. Elle ne
 * réordonne rien — l'ordre issu du placement, qui regroupe les familles,
 * est conservé — elle ne fait que garantir qu'aucune carte n'en recouvre
 * une autre.
 */
function resolveOverlaps(rows: Map<number, NodePosition[][]>): void {
  for (const blocks of rows.values()) {
    sortRowByPosition(blocks);
    spreadRow(blocks);
  }
}

/**
 * Met les rangées dans l'ordre qui croise le moins de traits.
 *
 * Le placement récursif décide de l'ordre horizontal au fil de sa descente,
 * sans jamais voir l'arbre en entier : la lignée d'un conjoint rencontrée
 * tard peut se poser entre deux familles déjà placées, et son trait doit
 * alors traverser les leurs pour rejoindre son enfant. Rien dans la
 * récursion ne peut le prévoir.
 *
 * Chaque bloc est donc réordonné selon la position moyenne de ce à quoi il
 * se rattache dans la rangée voisine — un bloc dont les enfants sont à
 * droite se place à droite. C'est la méthode classique de réduction des
 * croisements : appliquée en alternance vers le haut et vers le bas, elle
 * fait converger l'ordre de chaque rangée vers celui de ses voisines.
 *
 * Seul l'*ordre* est décidé ici ; les positions exactes restent à
 * `refinePositions`, qui les recentre ensuite famille par famille.
 */
function orderRows(rows: Map<number, NodePosition[][]>, graph: FamilyGraph): void {
  const generations = [...rows.keys()].sort((a, b) => a - b);
  if (generations.length < 2) return;

  for (let pass = 0; pass < 4; pass += 1) {
    const downward = pass % 2 === 0;
    const order = downward ? generations : [...generations].reverse();

    for (const generation of order) {
      const blocks = rows.get(generation)!;
      if (blocks.length < 2) continue;

      // Rang de chaque personne dans la rangée voisine, pour y mesurer une
      // position moyenne indépendante des largeurs.
      const referenceGeneration = downward ? generation - 1 : generation + 1;
      const referenceBlocks = rows.get(referenceGeneration);
      if (!referenceBlocks) continue;
      const rank = new Map<string, number>();
      referenceBlocks
        .flat()
        .sort((a, b) => a.x - b.x)
        .forEach((position, index) => rank.set(position.id, index));

      const scored = blocks.map((block, index) => {
        const ranks: number[] = [];
        for (const member of block) {
          const person = graph.people.get(member.id);
          if (!person) continue;
          for (const id of downward ? person.parents : person.children) {
            const found = rank.get(id);
            if (found !== undefined) ranks.push(found);
          }
        }
        // Sans rattachement dans la rangée voisine, un bloc garde sa place :
        // le déplacer n'éviterait aucun croisement et défferait un groupement
        // que le placement avait de bonnes raisons de former.
        const barycenter =
          ranks.length > 0 ? ranks.reduce((sum, value) => sum + value, 0) / ranks.length : index;
        return { block, barycenter, index };
      });

      scored.sort((a, b) => a.barycenter - b.barycenter || a.index - b.index);

      // Repose la rangée dans le nouvel ordre, au plus serré ; le recentrage
      // vient après.
      let cursor = Math.min(...blocks.flat().map((member) => member.x));
      for (const { block } of scored) {
        const left = Math.min(...block.map((member) => member.x));
        const shift = cursor - left;
        for (const member of block) member.x += shift;
        cursor = Math.max(...block.map((member) => member.x)) + CARD_WIDTH + SIBLING_GAP;
      }

      // L'ordre décidé doit survivre à cette fonction : `spreadRow` s'y fie
      // désormais au lieu de retrier par position.
      blocks.splice(0, blocks.length, ...scored.map((entry) => entry.block));
    }
  }
}

/**
 * Recentre chaque famille sur la sienne.
 *
 * Écarter les recouvrements suffit à rendre l'arbre lisible, mais pas juste :
 * un bloc poussé vers la droite n'entraîne ni ses parents ni ses enfants, et
 * la fratrie se retrouve décalée sous des parents restés en place. Le dessin
 * devient un empilement de rangées correctes qui ne se répondent plus.
 *
 * Chaque bloc est donc attiré, tour à tour, vers le milieu de ce à quoi il
 * est relié — ses parents au-dessus, ses enfants en dessous — puis la rangée
 * est réécartée pour que le gain ne se paie pas d'un recouvrement. En
 * alternant les passes vers le bas et vers le haut, les deux contraintes
 * finissent par se rencontrer là où elles peuvent : un couple au-dessus de
 * ses enfants, des enfants sous leurs parents.
 */
function refinePositions(
  rows: Map<number, NodePosition[][]>,
  positions: Map<string, NodePosition>,
  graph: FamilyGraph,
): void {
  const generations = [...rows.keys()].sort((a, b) => a - b);
  if (generations.length < 2) return;

  const centerOf = (members: NodePosition[]): number => {
    const min = Math.min(...members.map((m) => m.x));
    const max = Math.max(...members.map((m) => m.x)) + CARD_WIDTH;
    return (min + max) / 2;
  };

  /** Milieu des cartes citées, en ne comptant que celles réellement placées. */
  const anchorFor = (ids: Iterable<string>): number | undefined => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const id of ids) {
      const position = positions.get(id);
      if (!position) continue;
      min = Math.min(min, position.x);
      max = Math.max(max, position.x + CARD_WIDTH);
    }
    return Number.isFinite(min) ? (min + max) / 2 : undefined;
  };

  /*
   * Six passes, pas davantage — c'est un optimum mesuré, pas un compromis de
   * prudence. Chaque passe rapproche les familles mais écarte aussi un peu
   * les rangées, et au-delà de six le second effet l'emporte : sur l'arbre de
   * quatre-vingts personnes qui a servi de référence, douze passes rallongent
   * les traits au lieu de les raccourcir, et quarante les rallongent de
   * moitié.
   */
  for (let pass = 0; pass < 6; pass += 1) {
    const downward = pass % 2 === 0;
    const order = downward ? generations : [...generations].reverse();

    for (const generation of order) {
      const blocks = rows.get(generation)!;

      for (const block of blocks) {
        const related = new Set<string>();
        for (const member of block) {
          const person = graph.people.get(member.id);
          if (!person) continue;
          // Vers le bas, on suit ses parents ; vers le haut, ses enfants.
          for (const id of downward ? person.parents : person.children) related.add(id);
        }
        const anchor = anchorFor(related);
        if (anchor === undefined) continue;

        // Amorti : un bloc tiré d'un coup sur sa cible repousserait ses
        // voisins, qui repousseraient les leurs — la rangée entière
        // oscillerait d'une passe à l'autre au lieu de se poser.
        const shift = (anchor - centerOf(block)) * 0.6;
        if (Math.abs(shift) < 0.5) continue;
        for (const member of block) member.x += shift;
      }

      /*
       * Écarter puis recentrer la rangée sur elle-même.
       *
       * `spreadRow` ne sait que pousser vers la droite : à chaque passe, une
       * rangée qui se dégage gagne donc du terrain de ce côté, et rien ne le
       * lui reprend. Sur plusieurs passes cette dérive s'accumule — mesuré,
       * l'arbre s'élargissait d'un tiers et les traits s'allongeaient au lieu
       * de se raccourcir, si bien qu'augmenter le nombre de passes dégradait
       * le dessin. Ramener la rangée sur son propre centre après coup annule
       * ce biais sans rien changer aux écarts qu'elle vient d'obtenir.
       */
      const before = rowCenter(blocks);
      spreadRow(blocks);
      const drift = rowCenter(blocks) - before;
      if (Math.abs(drift) > 0.5) {
        for (const block of blocks) for (const member of block) member.x -= drift;
      }
    }
  }
}

/**
 * Calcule l'encombrement d'un sous-arbre, ascendance comprise.
 *
 * Le bloc occupe `[0, blockWidth]` dans son propre repère. Ses deux groupes
 * — l'ascendance au-dessus, la descendance en dessous — se centrent chacun
 * sur lui : c'est ce centrage qui fait qu'une fratrie tombe sous le milieu de
 * ses parents plutôt que sous l'un d'eux, et que les deux lignées d'un couple
 * se répartissent de part et d'autre.
 */
function measure(node: PlacementNode): void {
  for (const child of node.ancestorNodes) measure(child);
  for (const child of node.childNodes) measure(child);

  const profile: Profile = new Map();
  profile.set(node.generation, { min: 0, max: node.blockWidth });

  const blockCenter = node.blockWidth / 2;
  /** Centre horizontal du membre d'indice `index`, dans le repère du bloc. */
  const memberCenter = (index: number): number =>
    index * (CARD_WIDTH + COUPLE_GAP) + CARD_WIDTH / 2;

  // L'ascendance se centre sur le membre dont elle descend ; la descendance,
  // elle, se centre sur le couple entier — c'est ce qui fait tomber une
  // fratrie sous le milieu de ses parents plutôt que sous l'un d'eux.
  if (node.ancestorNodes.length > 0) {
    for (const ancestor of node.ancestorNodes) {
      const span = profileSpan(ancestor.profile);
      const target = memberCenter(ancestor.memberIndex ?? 0);
      ancestor.offset = target - (span.min + span.max) / 2;
    }
    const packed = packGroupFrom(node.ancestorNodes, profile);
    mergeProfile(profile, packed, 0);
  }

  if (node.childNodes.length > 0) {
    const groupProfile = packGroup(node.childNodes);
    const span = profileSpan(groupProfile);
    const shift = blockCenter - (span.min + span.max) / 2;
    for (const child of node.childNodes) child.offset += shift;
    mergeProfile(profile, groupProfile, shift);
  }

  node.profile = profile;
}

/**
 * Assigne les coordonnées définitives à partir des décalages calculés.
 *
 * Les générations sont des rangées régulières : la plus ancienne en haut, la
 * descendance en dessous. C'est la disposition de tous les arbres
 * généalogiques imprimés, et sa lisibilité tient précisément à cette
 * régularité — on suit une filiation en descendant, une fratrie en balayant
 * une ligne. Rien n'est décalé, courbé ni dispersé : ce qui doit se voir ici,
 * c'est la structure, pas une silhouette.
 *
 * `origin` est la position, en coordonnées du monde, de l'origine locale du
 * sous-arbre — celle à laquelle profils et décalages se rapportent.
 */
function assign(
  node: PlacementNode,
  origin: number,
  positions: Map<string, NodePosition>,
  graph: FamilyGraph,
): void {
  let cursor = origin;

  for (const memberId of node.members) {
    const generation = graph.people.get(memberId)?.generation ?? node.generation;
    positions.set(memberId, {
      id: memberId,
      x: cursor,
      y: generation * ROW_HEIGHT,
      generation,
    });
    cursor += CARD_WIDTH + COUPLE_GAP;
  }

  for (const child of node.ancestorNodes) {
    assign(child, origin + child.offset, positions, graph);
  }
  for (const child of node.childNodes) {
    assign(child, origin + child.offset, positions, graph);
  }
}



const decadeLabel = (years: number[]): string => {
  if (years.length === 0) return '';
  const sorted = [...years].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return `${Math.floor(median / 10) * 10}s`;
};

export function computeLayout(graph: FamilyGraph): TreeLayout {
  const { roots, blockOf } = buildPlacementForest(graph);
  const positions = new Map<string, NodePosition>();

  // Nombre de descendants par personne, calculé de bas en haut de l'ordre
  // topologique : les enfants sont toujours comptés avant leurs parents.
  const weights = new Map<string, number>();
  for (let i = graph.order.length - 1; i >= 0; i -= 1) {
    const id = graph.order[i];
    let total = 0;
    for (const childId of graph.people.get(id)?.children ?? []) {
      total += 1 + (weights.get(childId) ?? 0);
    }
    weights.set(id, total);
  }

  let cursor = 0;
  for (const root of roots) {
    measure(root);
    const span = profileSpan(root.profile);
    // L'origine se cale pour que le bord gauche réel du sous-arbre tombe
    // exactement sur le curseur.
    assign(root, cursor - span.min, positions, graph);
    cursor += span.max - span.min + FAMILY_GAP;
  }

  // Filet de sécurité : personne ne doit rester sans coordonnées.
  for (const id of graph.order) {
    if (positions.has(id)) continue;
    const generation = graph.people.get(id)?.generation ?? 0;
    positions.set(id, { id, x: cursor, y: generation * ROW_HEIGHT, generation });
    cursor += CARD_WIDTH + SIBLING_GAP;
  }

  /*
   * Trois passes, sur une seule et même découpe en rangées et en blocs :
   * écarter ce qui se recouvre, ordonner chaque rangée pour croiser le moins
   * de traits, puis recentrer chaque famille sur la sienne. L'ordre décidé
   * par la deuxième passe est ensuite tenu pour acquis — c'est pourquoi les
   * trois partagent `rows` au lieu de le recalculer chacune de leur côté.
   */
  const blockRows = groupByGeneration(positions, blockOf);
  resolveOverlaps(blockRows);
  orderRows(blockRows, graph);
  refinePositions(blockRows, positions, graph);

  // --- Liens ---
  const layoutUnions: LayoutUnion[] = [];
  const crossLinks: CrossLink[] = [];
  const unionsByPerson = new Map<string, string[]>();
  const unionById = new Map<string, LayoutUnion>();

  const partnerOf = (id: string): LayoutPartner | undefined => {
    const position = positions.get(id);
    return position ? { id, x: position.x, y: position.y } : undefined;
  };

  for (const union of graph.unions.values()) {
    const partners = union.partners
      .map(partnerOf)
      .filter((p): p is LayoutPartner => Boolean(p))
      .sort((a, b) => a.x - b.x);
    const children = union.children
      .map(partnerOf)
      .filter((c): c is LayoutPartner => Boolean(c))
      .sort((a, b) => a.x - b.x);

    if (partners.length === 0) continue;

    // Tolérance calée sur le décalage de rangée : deux conjoints d'un même bloc
    // le partagent, mais un mariage entre deux branches réunit deux blocs qui
    // ne l'ont pas — et ce couple-là doit tout de même se lire comme un couple.
    const sameRow =
      partners.length < 2 ||
      Math.abs(partners[0].y - partners[partners.length - 1].y) < ROW_HEIGHT * 0.25;
    const span = partners.length > 1 ? partners[partners.length - 1].x - partners[0].x : 0;
    const adjacent = sameRow && span <= CARD_WIDTH + COUPLE_GAP + 1;

    /*
     * Le point d'où part la descendance : le milieu du couple quand les deux
     * cartes sont voisines — mais seulement alors. Un mariage entre deux
     * branches (`adjacent` faux) n'a pas de bloc commun : `buildPlacementForest`
     * rattache les enfants au sous-arbre d'un seul des deux parents, celui qui
     * les a rencontrés en premier (voir plus haut, « la première visite emporte
     * les enfants »). Centrer entre les deux cartes déplacerait le départ de la
     * descente loin de l'endroit où les enfants sont réellement placés — un
     * détour qui n'existe que sur le papier, pas dans la disposition.
     */
    const anchorX =
      partners.length > 1 && adjacent
        ? (cardCenterX(partners[0].x) + cardCenterX(partners[partners.length - 1].x)) / 2
        : cardCenterX(partners[0].x);
    // L'arbre pousse vers le haut : la descendance part du trait qui relie les
    // deux cartes, ou du haut de la carte pour un parent seul.
    const anchorY =
      partners.length > 1 && adjacent
        ? portraitCenterY(Math.min(...partners.map((p) => p.y)))
        : portraitTop(partners[0].y);

    const layoutUnion: LayoutUnion = {
      id: union.id,
      partners,
      children,
      anchorX,
      anchorY,
      adjacent,
      status: union.status,
    };
    layoutUnions.push(layoutUnion);
    unionById.set(union.id, layoutUnion);

    for (const partner of partners) {
      const list = unionsByPerson.get(partner.id) ?? [];
      list.push(union.id);
      unionsByPerson.set(partner.id, list);
    }
    for (const child of children) {
      const list = unionsByPerson.get(child.id) ?? [];
      list.push(union.id);
      unionsByPerson.set(child.id, list);
    }

    if (partners.length > 1 && !adjacent) {
      crossLinks.push({
        id: union.id,
        a: partners[0],
        b: partners[partners.length - 1],
        status: union.status,
      });
    }
  }

  const branchOf = new Map<string, number>();

  // --- Cadre et frise des générations ---
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const yearsByGeneration = new Map<number, number[]>();
  const countByGeneration = new Map<number, number>();

  for (const position of positions.values()) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, cardTop(position.y));
    maxX = Math.max(maxX, position.x + CARD_WIDTH);
    maxY = Math.max(maxY, cardBottom(position.y));
    countByGeneration.set(position.generation, (countByGeneration.get(position.generation) ?? 0) + 1);
    const year = graph.people.get(position.id)?.birthYear;
    if (year) {
      const list = yearsByGeneration.get(position.generation) ?? [];
      list.push(year);
      yearsByGeneration.set(position.generation, list);
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = CARD_WIDTH;
    maxY = CARD_HEIGHT;
  }

  const rows: GenerationRow[] = [...countByGeneration.keys()]
    .sort((a, b) => a - b)
    .map((generation) => ({
      generation,
      y: generation * ROW_HEIGHT,
      count: countByGeneration.get(generation) ?? 0,
      label: decadeLabel(yearsByGeneration.get(generation) ?? []),
    }));


  return {
    positions,
    regions: computeRegions(graph, positions, branchOf),
    branchOf,
    weights,
    unions: layoutUnions,
    crossLinks,
    bounds: { minX, minY, maxX, maxY },
    rows,
    unionsByPerson,
    unionById,
  };
}

/**
 * Étendue horizontale de chaque branche nommée : son ancêtre, ses conjoints et
 * toute sa descendance. Les branches dont les membres sont dispersés (cas d'un
 * mariage entre lignées) sont écartées, car une étiquette couvrant la moitié de
 * l'arbre n'apprendrait rien.
 */
function computeRegions(
  graph: FamilyGraph,
  positions: Map<string, NodePosition>,
  branchOf: Map<string, number>,
): LayoutRegion[] {
  const regions: LayoutRegion[] = [];

  /*
   * La lignée la plus étroite l'emporte.
   *
   * Les branches s'emboîtent : la souche d'origine contient tout le monde, une
   * sous-branche n'en contient qu'une part. À attribuer la couleur au premier
   * venu, la souche prend cinq cents personnes sur cinq cent vingt-huit et le
   * diagramme redevient monochrome. On attribue donc de la plus large à la
   * plus étroite, si bien que c'est la dernière — la plus précise, celle qui
   * distingue vraiment une famille de sa voisine — qui reste.
   */
  const claimed: Array<{ index: number; members: Set<string> }> = [];

  graph.branches.forEach((branch, index) => {
    const anchor = graph.people.get(branch.anchorId);
    const anchorPosition = positions.get(branch.anchorId);
    if (!anchor || !anchorPosition) return;

    const seen = new Set<string>([branch.anchorId]);
    const queue = [branch.anchorId];
    let minX = anchorPosition.x;
    let maxX = anchorPosition.x + CARD_WIDTH;

    while (queue.length > 0) {
      const id = queue.pop()!;
      const person = graph.people.get(id);
      if (!person) continue;
      const position = positions.get(id);
      if (position) {
        minX = Math.min(minX, position.x);
        maxX = Math.max(maxX, position.x + CARD_WIDTH);
      }
      for (const nextId of [...person.children, ...person.spouseLinks.map((l) => l.id)]) {
        if (seen.has(nextId)) continue;
        // Un conjoint venu d'ailleurs n'entraîne pas sa propre lignée.
        if (person.spouseLinks.some((l) => l.id === nextId) && graph.people.get(nextId)?.parents.length) {
          continue;
        }
        seen.add(nextId);
        queue.push(nextId);
      }
    }

    claimed.push({ index, members: seen });

    regions.push({
      label: branch.label,
      anchorId: branch.anchorId,
      minX,
      maxX,
      centerX: (minX + maxX) / 2,
      y: anchorPosition.y,
      count: seen.size,
    });
  });

  claimed.sort((a, b) => b.members.size - a.members.size);
  for (const entry of claimed) {
    for (const id of entry.members) branchOf.set(id, entry.index);
  }

  return regions.sort((a, b) => a.minX - b.minX);
}
