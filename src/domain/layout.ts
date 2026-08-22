import { jitter } from '@/lib/hash';
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

/**
 * Le tronc, sous les fondateurs.
 *
 * Les lignées les plus anciennes sont plusieurs, mais un arbre n'a qu'un pied :
 * les réunir sur un tronc commun est ce qui transforme une juxtaposition de
 * généalogies en un seul arbre.
 */
export interface TrunkLayout {
  x: number;
  /** Sommet : là où le tronc se divise vers les fondateurs. */
  topY: number;
  /** Pied, au niveau du sol. */
  baseY: number;
  width: number;
  roots: { x: number; y: number; weight: number }[];
}

export interface TreeLayout {
  positions: Map<string, NodePosition>;
  trunk: TrunkLayout;
  regions: LayoutRegion[];
  /**
   * Nombre de descendants de chaque personne. C'est ce qui donne son épaisseur
   * à une branche : une lignée qui porte cinq cents personnes est un maître
   * branche, une personne sans descendance est un rameau.
   */
  weights: Map<string, number>;
  unions: LayoutUnion[];
  crossLinks: CrossLink[];
  bounds: Bounds;
  rows: GenerationRow[];
  /** Ordre de dessin des liens : les unions d'abord, indexées par personne. */
  unionsByPerson: Map<string, string[]>;
  unionById: Map<string, LayoutUnion>;
}

interface PlacementNode {
  anchorId: string;
  /** Personnes du bloc, de gauche à droite (conjoints inclus). */
  members: string[];
  /** Sous-arbres enfants, dans l'ordre horizontal. */
  childNodes: PlacementNode[];
  generation: number;
  blockWidth: number;
  /** Position du bloc, relative à l'origine locale du sous-arbre. */
  blockOffset: number;
  /** Décalage de ce sous-arbre par rapport à l'origine de son parent. */
  offset: number;
  contour: Contour;
}

/**
 * Place chaque personne une seule fois.
 *
 * Une personne mariée dans la famille apparaît à côté de son conjoint ; une
 * personne née dans la famille apparaît sous ses parents. Quand les deux
 * conjoints sont nés dans l'arbre, le premier rencontré garde sa place et
 * l'union devient un lien croisé — ce que fait aussi un arbre sur papier.
 */
function buildPlacementForest(graph: FamilyGraph): PlacementNode[] {
  const { people, unions } = graph;
  const placed = new Set<string>();
  const placedUnions = new Set<string>();
  const roots: PlacementNode[] = [];

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

    // Conjoints encore libres : ils rejoignent le bloc de cette personne.
    // Un conjoint dont les parents figurent dans l'arbre garde en revanche sa
    // place dans sa propre lignée ; son mariage devient alors un lien croisé.
    const attachedSpouses: string[] = [];
    for (const unionId of person.unionIds) {
      const union = unions.get(unionId);
      if (!union) continue;
      const partnerId = union.partners.find((p) => p !== anchorId);
      if (!partnerId) continue;
      if (placed.has(partnerId)) continue;
      if ((people.get(partnerId)?.parents.length ?? 0) > 0) continue;
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

    const node: PlacementNode = {
      anchorId,
      members,
      childNodes: [],
      generation: person.generation,
      blockWidth: members.length * CARD_WIDTH + (members.length - 1) * COUPLE_GAP,
      blockOffset: 0,
      offset: 0,
      contour: { left: [0], right: [0] },
    };

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

  return roots;
}

/**
 * Place les sous-arbres par contours plutôt qu'en bandes exclusives.
 *
 * Le placement naïf réserve à chaque sous-arbre une bande où nul autre n'entre.
 * Une personne sans descendance monopolise alors une colonne sur toute la
 * hauteur de l'arbre, et la largeur totale finit par valoir le nombre de
 * feuilles plutôt que la population de la génération la plus fournie — deux
 * fois et demie l'espace nécessaire, dans ce jeu de données. Les branches
 * doivent parcourir cette largeur en une génération de hauteur, ce qui les
 * couche à l'horizontale.
 *
 * On garde donc, pour chaque sous-arbre, la silhouette de ses bords gauche et
 * droit, niveau par niveau. Deux voisins ne s'écartent alors que de ce que
 * leurs silhouettes exigent réellement : une branche courte se glisse sous la
 * ramure de sa voisine au lieu de la pousser.
 */
interface Contour {
  /** Bord gauche, par profondeur relative au nœud (0 = sa propre rangée). */
  left: number[];
  right: number[];
}

function measure(node: PlacementNode): void {
  if (node.childNodes.length === 0) {
    node.blockOffset = 0;
    node.contour = { left: [0], right: [node.blockWidth] };
    return;
  }

  const merged: Contour = { left: [], right: [] };

  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    measure(child);

    if (i === 0) {
      child.offset = 0;
    } else {
      // Décalage minimal : le plus grand empiètement constaté sur les niveaux
      // que les deux silhouettes ont en commun.
      let shift = 0;
      const shared = Math.min(merged.right.length, child.contour.left.length);
      for (let d = 0; d < shared; d += 1) {
        shift = Math.max(shift, merged.right[d] - child.contour.left[d] + SIBLING_GAP);
      }
      child.offset = shift;
    }

    for (let d = 0; d < child.contour.left.length; d += 1) {
      const left = child.contour.left[d] + child.offset;
      const right = child.contour.right[d] + child.offset;
      if (d < merged.left.length) {
        merged.left[d] = Math.min(merged.left[d], left);
        merged.right[d] = Math.max(merged.right[d], right);
      } else {
        merged.left.push(left);
        merged.right.push(right);
      }
    }
  }

  // Le parent se centre sur la rangée de ses enfants — pas sur leur silhouette
  // entière, qui peut déborder très loin à cause d'une descendance lointaine.
  const first = node.childNodes[0];
  const last = node.childNodes[node.childNodes.length - 1];
  const childrenCenter =
    (first.offset + first.contour.left[0] + last.offset + last.contour.right[0]) / 2;
  node.blockOffset = childrenCenter - node.blockWidth / 2;

  node.contour = {
    left: [node.blockOffset, ...merged.left],
    right: [node.blockOffset + node.blockWidth, ...merged.right],
  };
}

/** Étendue horizontale réellement occupée par un sous-arbre. */
function contourSpan(node: PlacementNode): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let d = 0; d < node.contour.left.length; d += 1) {
    min = Math.min(min, node.contour.left[d]);
    max = Math.max(max, node.contour.right[d]);
  }
  return { min, max };
}

/*
 * ============================================================================
 *  LA SILHOUETTE
 *
 *  Le placement par contours ci-dessus répond à une question de lisibilité :
 *  qui va où, sans que personne n'en écrase un autre. Il ne répond pas à la
 *  question de la forme, et sa réponse implicite est la pire possible — un
 *  rectangle. Mesuré sur ce jeu de données : la génération des fondateurs, qui
 *  compte quatre personnes, s'étalait sur six mille cinq cents unités, et
 *  chacune des dix générations occupait la largeur entière. Un arbre dont
 *  toutes les rangées ont la même envergure n'est pas un arbre, c'est une
 *  étagère — et ses branches basses, forcées de traverser toute la largeur en
 *  une génération de hauteur, partaient à l'horizontale comme des câbles.
 *
 *  Trois gestes lui rendent sa forme.
 * ==========================================================================*/

/**
 * L'évasement.
 *
 * Chaque génération est ramenée vers l'axe du tronc d'autant plus fort qu'elle
 * est ancienne : les fondateurs se serrent sur la souche, et l'envergure ne
 * s'ouvre qu'en montant. C'est ce que fait un arbre, et c'est aussi ce que dit
 * la généalogie — une lignée part d'un point et se répand.
 *
 * L'exposant décide du profil. Au-dessus de 1 l'arbre monte en colonne puis
 * s'ouvre d'un coup, comme un pin parasol ; en dessous il s'évase vite puis se
 * calme, ce qui donne le port étalé d'un chêne. La base n'est jamais nulle :
 * quatre fondateurs doivent tenir côte à côte sans se recouvrir.
 */
const CROWN_BASE = 0.085;
const CROWN_CURVE = 0.7;

const crownSpread = (generation: number, depth: number): number => {
  if (depth <= 0) return 1;
  const t = Math.min(1, Math.max(0, generation / depth));
  return CROWN_BASE + (1 - CROWN_BASE) * Math.pow(t, CROWN_CURVE);
};

/**
 * Le dôme.
 *
 * Un cône reste un cône : sa cime est un bord droit. Ce qui fait la couronne
 * d'un arbre, c'est que le centre monte plus haut que les flancs — les
 * branches du milieu ne sont bridées par rien, celles du pourtour retombent
 * sous leur propre poids. La correction est parabolique et s'applique au bloc
 * entier, jamais à une personne seule : deux conjoints doivent rester à la
 * même altitude, sinon leur trait d'alliance part en biais.
 */
const CROWN_DOME = ROW_HEIGHT * 3.1;

/**
 * L'étagement.
 *
 * Des générations régulièrement espacées font un escalier, pas un arbre. Un
 * arbre divise de plus en plus court à mesure qu'il monte : le fût court
 * longtemps sans rien porter, les maîtresses branches se séparent largement,
 * puis la division s'accélère jusqu'aux rameaux, qui ne font plus que quelques
 * dizaines de centimètres entre deux fourches.
 *
 * Avec un écart constant, chaque branche terminale mesurait une génération
 * entière — mille unités pour trois cents de déport. La cime devenait une
 * roselière : des centaines de tiges parallèles, de même longueur, coiffées
 * chacune d'une rosette. C'est le défaut le plus visible de l'ancienne
 * silhouette, et il ne tenait pas au feuillage mais à l'étagement.
 */
const RISE_BASE = 1.55;
const RISE_TIP = 0.4;
const RISE_CURVE = 0.85;

const generationGap = (generation: number, depth: number): number => {
  if (depth <= 0) return ROW_HEIGHT;
  const t = Math.min(1, Math.max(0, generation / depth));
  return ROW_HEIGHT * (RISE_BASE + (RISE_TIP - RISE_BASE) * Math.pow(t, RISE_CURVE));
};

/** Altitude de chaque génération au-dessus de la souche, par cumul des écarts. */
function generationRise(depth: number): number[] {
  const rise = [0];
  for (let g = 0; g < depth; g += 1) rise.push(rise[g] + generationGap(g, depth));
  return rise;
}

/**
 * Le désordre.
 *
 * Toutes les personnes d'une génération à la même altitude, c'est un tableau à
 * double entrée : l'œil suit les rangées horizontales avant de suivre les
 * filiations. Un tiers de l'écart local suffit à casser l'alignement — mesuré,
 * l'ancien dixième laissait des bandes de feuillage parfaitement horizontales
 * visibles à toutes les échelles. Il se mesure sur l'écart de la génération et
 * non sur une constante : en haut, où les fourches se resserrent, un désordre
 * calibré sur le bas ferait passer les enfants sous leurs parents.
 */
const CROWN_SCATTER = 0.3;

/**
 * L'échelonnement d'une fratrie.
 *
 * C'est le dernier endroit d'où sortait une ligne droite, et le plus visible.
 * Seize frères et sœurs placés à la même altitude sur trois mille unités de
 * large ne peuvent donner qu'une chose : une poutre horizontale, avec les
 * médaillons enfilés dessus comme des perles. Aucun dessin de branche ne
 * rattrape cela — la maîtresse branche qui les dessert est horizontale parce
 * que ses destinations le sont.
 *
 * Sur une vraie branche, les rameaux ne sont pas alignés : ils s'étagent, et
 * le plus éloigné du tronc est aussi le plus haut, parce que la branche montait
 * en s'éloignant. On rend donc à chaque enfant une altitude proportionnelle à
 * son déport — une pente franche, plafonnée pour ne jamais empiéter sur la
 * génération suivante.
 */
const SIBLING_SLOPE = 0.36;
const SIBLING_CLIMB = 0.85;

interface Shape {
  /** Axe vers lequel les générations anciennes se resserrent. */
  axis: number;
  /** Demi-envergure brute, pour normaliser le dôme. */
  halfWidth: number;
  /** Génération la plus récente. */
  depth: number;
}

const domeLift = (x: number, shape: Shape): number => {
  const t = Math.min(1, Math.abs(x - shape.axis) / shape.halfWidth);
  return CROWN_DOME * (1 - t * t);
};

/** Un bloc posé : ce qui doit bouger d'un seul tenant. */
interface PlacedBlock {
  generation: number;
  members: string[];
}

/**
 * Assigne les coordonnées définitives à partir des décalages calculés.
 * `origin` est la position, en coordonnées du monde, de l'origine locale du
 * sous-arbre — celle à laquelle contours et décalages se rapportent.
 *
 * `shape` absent, le placement est brut : c'est la première passe, celle qui
 * sert à connaître l'axe et l'envergure avant de pouvoir les resserrer.
 */
function assign(
  node: PlacementNode,
  origin: number,
  positions: Map<string, NodePosition>,
  blocks: PlacedBlock[],
  graph: FamilyGraph,
  rise: number[],
  shape: Shape | null,
  /** Élévation supplémentaire, imposée par le parent : voir `SIBLING_SLOPE`. */
  climb = 0,
): void {
  const depth = rise.length - 1;

  /** Abscisse du centre d'un bloc, une fois l'évasement appliqué. */
  const centerOf = (target: PlacementNode, targetOrigin: number): number => {
    const left = targetOrigin + target.blockOffset;
    const x = shape
      ? shape.axis + (left - shape.axis) * crownSpread(target.generation, depth)
      : left;
    return x + target.blockWidth / 2;
  };

  // L'évasement s'applique au bord du bloc, puis les membres sont posés à leur
  // écart normal : un couple resserré vers l'axe reste un couple, ses deux
  // cartes ne se rapprochent pas l'une de l'autre.
  const center = centerOf(node, origin);
  let cursor = center - node.blockWidth / 2;

  const lift = jitter(node.anchorId, 3, generationGap(node.generation, depth) * CROWN_SCATTER);
  const dome = shape ? domeLift(center, shape) : 0;
  const top = rise[depth];

  const members: string[] = [];
  for (const memberId of node.members) {
    const generation = graph.people.get(memberId)?.generation ?? node.generation;
    const altitude = rise[Math.min(rise.length - 1, Math.max(0, generation))];
    positions.set(memberId, {
      id: memberId,
      x: cursor,
      // Axe inversé : la génération la plus ancienne est en bas, à la racine.
      // L'arbre pousse alors vers le haut, du tronc vers le feuillage.
      y: top - altitude + lift - dome - climb,
      generation,
    });
    members.push(memberId);
    cursor += CARD_WIDTH + COUPLE_GAP;
  }
  blocks.push({ generation: node.generation, members });

  for (const child of node.childNodes) {
    const childOrigin = origin + child.offset;
    // Le rameau le plus éloigné est aussi le plus haut : la branche montait en
    // s'éloignant. Plafonné à une fraction de l'écart des générations, sans
    // quoi une fratrie très étalée irait toucher la rangée suivante.
    const away = Math.abs(centerOf(child, childOrigin) - center);
    const gap = generationGap(child.generation, depth);
    assign(
      child,
      childOrigin,
      positions,
      blocks,
      graph,
      rise,
      shape,
      Math.min(gap * SIBLING_CLIMB, away * SIBLING_SLOPE),
    );
  }
}

/**
 * Le desserrement.
 *
 * Resserrer une génération vers l'axe la comprime, et rien ne garantit que la
 * place reste suffisante là où les familles se pressaient déjà. On repousse
 * donc, génération par génération, ce qui se recouvre — puis on recentre
 * l'ensemble sur sa position d'origine, sans quoi toute la rangée dériverait
 * vers la droite.
 *
 * Les blocs se déplacent d'un seul tenant : c'est la seule façon de garantir
 * qu'un couple reste accolé.
 */
function relax(blocks: PlacedBlock[], positions: Map<string, NodePosition>): void {
  const byGeneration = new Map<number, PlacedBlock[]>();
  for (const block of blocks) {
    const list = byGeneration.get(block.generation);
    if (list) list.push(block);
    else byGeneration.set(block.generation, [block]);
  }

  for (const list of byGeneration.values()) {
    const items: Array<{ block: PlacedBlock; left: number; width: number; shift: number }> = [];
    for (const block of list) {
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      for (const id of block.members) {
        const position = positions.get(id);
        if (!position) continue;
        left = Math.min(left, position.x);
        right = Math.max(right, position.x + CARD_WIDTH);
      }
      if (Number.isFinite(left)) items.push({ block, left, width: right - left, shift: 0 });
    }
    if (items.length < 2) continue;

    items.sort((a, b) => a.left - b.left);
    const before = (items[0].left + items[items.length - 1].left + items[items.length - 1].width) / 2;

    let edge = Number.NEGATIVE_INFINITY;
    for (const item of items) {
      const target = Math.max(item.left, edge + SIBLING_GAP);
      item.shift = target - item.left;
      edge = target + item.width;
    }

    const last = items[items.length - 1];
    const after = (items[0].left + items[0].shift + last.left + last.shift + last.width) / 2;
    const recenter = before - after;

    for (const item of items) {
      const delta = item.shift + recenter;
      if (delta === 0) continue;
      for (const id of item.block.members) {
        const position = positions.get(id);
        if (position) position.x += delta;
      }
    }
  }
}

/**
 * L'ordre des générations, garanti.
 *
 * Le dôme et le désordre déplacent chaque bloc verticalement pour la seule
 * raison de la silhouette, sans rien savoir de la parenté : un parent posé au
 * centre de la couronne peut ainsi se retrouver plus haut qu'un enfant rejeté
 * sur le flanc, et la branche qui les relie redescendrait. On remonte alors
 * l'enfant — jamais le parent, qui porte le reste de l'arbre sous lui — et
 * comme les personnes sont parcourues de la plus ancienne à la plus récente,
 * une seule passe suffit à propager la correction jusqu'aux rameaux.
 */
function enforceOrder(
  graph: FamilyGraph,
  positions: Map<string, NodePosition>,
  blocks: PlacedBlock[],
  clearance: (generation: number) => number,
): void {
  const blockOf = new Map<string, PlacedBlock>();
  for (const block of blocks) {
    for (const id of block.members) blockOf.set(id, block);
  }

  for (const id of graph.order) {
    const parent = positions.get(id);
    if (!parent) continue;
    for (const childId of graph.people.get(id)?.children ?? []) {
      const child = positions.get(childId);
      if (!child) continue;
      const ceiling = parent.y - clearance(parent.generation);
      if (child.y <= ceiling) continue;

      const shift = child.y - ceiling;
      const block = blockOf.get(childId);
      if (!block) {
        child.y = ceiling;
        continue;
      }
      for (const memberId of block.members) {
        const position = positions.get(memberId);
        if (position) position.y -= shift;
      }
    }
  }
}

const decadeLabel = (years: number[]): string => {
  if (years.length === 0) return '';
  const sorted = [...years].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return `${Math.floor(median / 10) * 10}s`;
};

export function computeLayout(graph: FamilyGraph): TreeLayout {
  const roots = buildPlacementForest(graph);
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

  // Profondeur totale : sert à retourner l'axe vertical une fois pour toutes.
  let depth = 0;
  for (const generation of graph.generations) depth = Math.max(depth, generation);

  // Deux passes, parce que la silhouette a besoin de connaître l'arbre entier
  // avant de pouvoir le remodeler : l'axe vers lequel on resserre et
  // l'envergure qui normalise le dôme ne sont connus qu'une fois tout le monde
  // posé. La première passe ne sert qu'à les mesurer.
  const origins: Array<{ root: PlacementNode; origin: number }> = [];
  let cursor = 0;
  for (const root of roots) {
    measure(root);
    const span = contourSpan(root);
    // L'origine se cale pour que le bord gauche réel du sous-arbre tombe
    // exactement sur le curseur.
    origins.push({ root, origin: cursor - span.min });
    cursor += span.max - span.min + FAMILY_GAP;
  }

  const rise = generationRise(depth);

  const draft = new Map<string, NodePosition>();
  const draftBlocks: PlacedBlock[] = [];
  for (const { root, origin } of origins) {
    assign(root, origin, draft, draftBlocks, graph, rise, null);
  }

  let rawLeft = Number.POSITIVE_INFINITY;
  let rawRight = Number.NEGATIVE_INFINITY;
  for (const position of draft.values()) {
    rawLeft = Math.min(rawLeft, position.x);
    rawRight = Math.max(rawRight, position.x + CARD_WIDTH);
  }
  const shape: Shape = Number.isFinite(rawLeft)
    ? { axis: (rawLeft + rawRight) / 2, halfWidth: Math.max(1, (rawRight - rawLeft) / 2), depth }
    : { axis: 0, halfWidth: 1, depth };

  const blocks: PlacedBlock[] = [];
  for (const { root, origin } of origins) {
    assign(root, origin, positions, blocks, graph, rise, shape);
  }

  relax(blocks, positions);
  // Un peu moins de la moitié de l'écart local : assez pour qu'une branche
  // montante se lise comme une montée, jamais assez pour rouvrir les bandes
  // horizontales que le désordre vient de casser.
  enforceOrder(graph, positions, blocks, (generation) => generationGap(generation, depth) * 0.45);

  // Filet de sécurité : personne ne doit rester sans coordonnées.
  for (const id of graph.order) {
    if (positions.has(id)) continue;
    const generation = graph.people.get(id)?.generation ?? 0;
    positions.set(id, {
      id,
      x: cursor,
      y: rise[depth] - rise[Math.min(depth, Math.max(0, generation))],
      generation,
    });
    cursor += CARD_WIDTH + SIBLING_GAP;
  }

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

  // --- Cadre et frise des générations ---
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const yearsByGeneration = new Map<number, number[]>();
  const countByGeneration = new Map<number, number>();
  const heightByGeneration = new Map<number, number>();

  for (const position of positions.values()) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, cardTop(position.y));
    maxX = Math.max(maxX, position.x + CARD_WIDTH);
    maxY = Math.max(maxY, cardBottom(position.y));
    countByGeneration.set(position.generation, (countByGeneration.get(position.generation) ?? 0) + 1);
    heightByGeneration.set(
      position.generation,
      (heightByGeneration.get(position.generation) ?? 0) + position.y,
    );
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
    .map((generation) => {
      const count = countByGeneration.get(generation) ?? 0;
      return {
        generation,
        // L'altitude moyenne de la génération, et non plus sa formule : depuis
        // que le dôme et le désordre déplacent chaque bloc, aucune génération
        // n'est plus à la hauteur que le calcul lui prédisait. Le rail des
        // générations doit viser où les gens sont.
        y:
          count > 0
            ? (heightByGeneration.get(generation) ?? 0) / count
            : rise[depth] - rise[Math.min(depth, Math.max(0, generation))],
        count,
        label: decadeLabel(yearsByGeneration.get(generation) ?? []),
      };
    });

  const trunk = computeTrunk(graph, positions, weights);

  return {
    positions,
    trunk,
    regions: computeRegions(graph, positions),
    weights,
    unions: layoutUnions,
    crossLinks,
    bounds: { minX, minY, maxX, maxY: Math.max(maxY, trunk.baseY) },
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
): LayoutRegion[] {
  const regions: LayoutRegion[] = [];

  for (const branch of graph.branches) {
    const anchor = graph.people.get(branch.anchorId);
    const anchorPosition = positions.get(branch.anchorId);
    if (!anchor || !anchorPosition) continue;

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

    regions.push({
      label: branch.label,
      anchorId: branch.anchorId,
      minX,
      maxX,
      centerX: (minX + maxX) / 2,
      y: anchorPosition.y,
      count: seen.size,
    });
  }

  return regions.sort((a, b) => a.minX - b.minX);
}


/** Hauteur du fût, sous la génération la plus ancienne. */
/*
 * Hauteur du fût.
 *
 * Un tronc court et large fait un bloc, pas un arbre : c'est l'élancement qui
 * le désigne comme tel. Le fût doit donc rester plusieurs fois plus haut que
 * large, même quand l'arbre porte des centaines de personnes.
 */
const TRUNK_RISE = ROW_HEIGHT * 3.1;
/** Profondeur des racines sous le sol. */
const ROOT_DEPTH = ROW_HEIGHT * 0.5;

function computeTrunk(
  graph: FamilyGraph,
  positions: Map<string, NodePosition>,
  weights: Map<string, number>,
): TrunkLayout {
  const roots: TrunkLayout['roots'] = [];
  let lowest = 0;

  for (const [id, position] of positions) {
    const person = graph.people.get(id);
    if (!person) continue;
    // Seule la génération la plus ancienne forme la souche.
    //
    // « Sans parents connus » ne suffit pas : chaque conjoint entré dans la
    // famille à n'importe quelle génération est dans ce cas, et le prendre pour
    // un fondateur ferait partir du pied de l'arbre une branche qui traverse
    // toute la ramure.
    if (person.generation !== 0 || person.parents.length > 0) continue;
    if (person.children.length === 0) continue;
    roots.push({
      x: cardCenterX(position.x),
      // Le centre du portrait, et non le bas de la carte : sous la carte, le
      // fût s'arrêtait quarante-cinq unités sous le médaillon, derrière le
      // texte du nom — donc dans le vide, avec un trou franc entre sa coupe et
      // les fondateurs qu'il est censé porter.
      y: portraitCenterY(position.y),
      weight: 1 + (weights.get(id) ?? 0),
    });
    lowest = Math.max(lowest, cardBottom(position.y));
  }

  // Un couple fondateur ne mérite qu'un départ : deux branches accolées
  // dessineraient une fourche là où l'arbre n'en a pas.
  roots.sort((a, b) => a.x - b.x);
  const merged: TrunkLayout['roots'] = [];
  for (const root of roots) {
    const previous = merged[merged.length - 1];
    if (previous && root.x - previous.x < CARD_WIDTH + COUPLE_GAP + 8) {
      previous.x = (previous.x + root.x) / 2;
      previous.weight += root.weight;
      continue;
    }
    merged.push({ ...root });
  }
  roots.length = 0;
  roots.push(...merged);

  if (roots.length === 0) {
    return { x: 0, topY: 0, baseY: ROOT_DEPTH, width: 40, roots: [] };
  }

  // L'axe du tronc se place au barycentre des lignées, pondéré par ce que
  // chacune porte : le pied se trouve sous la masse qu'il soutient.
  let totalWeight = 0;
  let weighted = 0;
  for (const root of roots) {
    totalWeight += root.weight;
    weighted += root.x * root.weight;
  }

  return {
    x: weighted / totalWeight,
    // La division ne se fait pas au niveau des fondateurs mais bien en dessous.
    // Sinon les départs vers des lignées réparties sur toute la largeur sont
    // rigoureusement horizontaux, et le pied de l'arbre devient une barre.
    topY: lowest + TRUNK_RISE * 0.62,
    baseY: lowest + TRUNK_RISE + ROOT_DEPTH,
    width: Math.min(430, 40 + 13 * Math.sqrt(totalWeight)),
    roots,
  };
}
