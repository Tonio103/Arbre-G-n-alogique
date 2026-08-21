import type {
  Bounds,
  CrossLink,
  LayoutUnion,
  NodePosition,
  TrunkLayout,
} from '@/domain/layout';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  PORTRAIT_RADIUS,
  ROW_HEIGHT,
  cardCenterX,
  portraitBottom,
  portraitCenterY,
  portraitTop,
} from './metrics';
import { fade } from './colors';
import { hashN, jitter, traceBark, traceLeafCrown } from './organic';
import {
  drawBirds,
  drawClouds,
  drawMotes,
  drawPetals,
  type AmbienceParams,
  type AmbiencePalette,
} from './ambience';
import {
  drawDapples,
  drawGround,
  drawSoilGrain,
  drawStones,
  drawUndergrowth,
  groundLevel,
  type SceneryPalette,
} from './scenery';
import { visibleRect, type Transform } from './viewport';

export interface TreePalette extends SceneryPalette, AmbiencePalette {
  /** Bois près de la racine. */
  trunk: string;
  /** Bois des rameaux, en haut de l'arbre. */
  twig: string;
  /** Creux de l'écorce, plus sombre que le bois. */
  bark: string;
  /** Face éclairée du bois. */
  woodLight: string;
  /** Face à l'ombre. */
  woodShade: string;
  /** Filet vif sur l'arête éclairée. */
  woodSheen: string;
  /** Branche estompée quand une lignée est sélectionnée. */
  dim: string;
  highlight: string;
  /** Mariage entre deux branches éloignées. */
  cross: string;
  /** Lien d'alliance entre deux conjoints voisins. */
  marriage: string;
  /** Feuillage : personnes sans descendance connue. */
  leaf: string;
  /** Feuilles d'ombre, au fond de la couronne. */
  leafAlt: string;
  /** Feuilles que la lumière traverse, sur le dessus. */
  leafLit: string;
  /** Points des personnes en vue lointaine. */
  node: string;
}

export interface DrawParams {
  unions: LayoutUnion[];
  crossLinks: CrossLink[];
  weights: Map<string, number>;
  bounds: Bounds;
  transform: Transform;
  width: number;
  height: number;
  dpr: number;
  palette: TreePalette;
  highlighted: Set<string>;
  hasSelection: boolean;
  trunk: TrunkLayout;
  /** Personnes visibles : sert à poser le feuillage sur les rameaux terminaux. */
  nodes: NodePosition[];
  /** Phase de la brise, en secondes : ce qui incline l'herbe et le feuillage. */
  time: number;
  /** Position de la personne sélectionnée, d'où rayonne le surlignage. */
  focus: { x: number; y: number } | null;
  /**
   * Vrai quand la vue est au repos.
   *
   * Le modelé du bois et l'épaisseur du feuillage triplent le coût d'une image.
   * Ce sont des détails qu'on lit posément, pas pendant qu'on fait défiler un
   * arbre : les suspendre en mouvement rend la navigation au déplacement, et
   * la première image immobile les rétablit.
   */
  detailed: boolean;
}

/**
 * Épaisseur d'une branche selon ce qu'elle porte.
 *
 * En racine carrée, comme dans un arbre réel où la section d'une branche
 * équivaut à peu près à la somme des sections qu'elle nourrit : le tronc est
 * massif, les rameaux terminaux sont fins, et la transition est continue.
 */
function thickness(descendants: number): number {
  return 2.4 + 6.5 * Math.sqrt(descendants);
}

/**
 * Épaisseur réellement tracée, plancher d'écran compris.
 *
 * Un rameau terminal mesure une dizaine d'unités : vu de loin, il tomberait
 * sous le pixel et la ramure disparaîtrait. On lui garantit donc une épaisseur
 * minimale exprimée en pixels d'écran — et seulement un minimum. L'ancienne
 * méthode multipliait toutes les épaisseurs par un même facteur : les grosses
 * branches, déjà larges, devenaient des masses pleines qui noyaient l'arbre.
 */
const boneWidth = (descendants: number, floor: number): number =>
  Math.max(thickness(descendants), floor);

/** Hauteur de la fourche d'où partent les branches vers les enfants. */
const forkOffset = (parentY: number): number =>
  portraitTop(parentY) - (ROW_HEIGHT - CARD_HEIGHT) * 0.46;

/**
 * Trace une branche fuselée entre deux points, en polygone plutôt qu'en trait :
 * l'épaisseur doit décroître le long du parcours, ce qu'un `lineWidth` constant
 * ne permet pas.
 *
 * `sway` écarte la courbe de sa trajectoire idéale. Sans lui, toutes les
 * branches d'une même fratrie décrivent exactement le même S et l'ensemble se
 * lit comme un diagramme ; avec lui, chacune part chercher sa place.
 */
interface BranchShading {
  /** Fraction de l'épaisseur occupée par la bande, entre 0 et 1. */
  width: number;
  /** Décalage du centre de la bande, en fraction de la demi-épaisseur.
   *  Négatif vers la gauche du sens de parcours, positif vers la droite. */
  offset: number;
}

/**
 * Échantillonne la courbe d'une branche.
 *
 * Renvoie, pour chaque point du parcours, sa position, la normale à la courbe
 * et la demi-épaisseur du bois à cet endroit — de quoi dessiner le polygone,
 * mais aussi de quoi accrocher quelque chose dessus : une brindille part
 * toujours d'un point précis d'une branche, avec l'inclinaison de ce point.
 */
function sampleBranch(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w0: number,
  w1: number,
  segments: number,
  sway: number,
): number[] {
  const dy = y1 - y0;
  const dx = x1 - x0;

  // Contrôles verticaux : la branche quitte le tronc à la verticale et rejoint
  // l'enfant à la verticale, ce qui donne la courbe en S d'une vraie ramure.
  //
  // L'élan de départ ne peut pas dépendre du seul écart vertical. Quand un
  // enfant est à des milliers d'unités sur le côté pour une génération de haut,
  // une courbe proportionnée à cet écart part presque à plat et la branche
  // devient un câble tendu. On lui donne donc de quoi s'élever d'abord, en
  // proportion de la distance à parcourir : elle monte, puis s'incline vers son
  // enfant — ce que fait une branche qui s'étale.
  // L'élan de départ reste sous la hauteur d'une génération : au-delà, la
  // branche dépasse la rangée de son enfant puis redescend, et ce retour
  // croise les branches voisines.
  const rise = Math.max(Math.abs(dy) * 0.55, Math.min(Math.abs(dx) * 0.22, Math.abs(dy) * 0.95));
  const lift = dy < 0 ? -rise : rise;

  const c1x = x0 + sway;
  const c1y = y0 + lift;
  const c2x = x1 - sway * 0.45;
  const c2y = y1 - dy * 0.55;

  const spine: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const mt = 1 - t;

    const x =
      mt * mt * mt * x0 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x1;
    const y =
      mt * mt * mt * y0 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y1;

    const tx =
      3 * mt * mt * (c1x - x0) + 6 * mt * t * (c2x - c1x) + 3 * t * t * (x1 - c2x);
    const ty =
      3 * mt * mt * (c1y - y0) + 6 * mt * t * (c2y - c1y) + 3 * t * t * (y1 - c2y);
    const length = Math.hypot(tx, ty) || 1;

    // L'amincissement suit une courbe, pas une droite : le renflement reste
    // près du départ, comme au départ d'une vraie branche.
    const half = (w0 + (w1 - w0) * (t * t * (3 - 2 * t))) / 2;

    spine.push(x, y, -ty / length, tx / length, half);
  }

  return spine;
}

/** Nombre de points d'un parcours échantillonné. */
const SPINE_STRIDE = 5;

/**
 * Pose le polygone d'une branche à partir de son parcours.
 *
 * En polygone plutôt qu'en trait : l'épaisseur doit décroître le long du
 * parcours, ce qu'un `lineWidth` constant ne permet pas.
 */
function emitBranch(
  ctx: CanvasRenderingContext2D,
  spine: number[],
  /**
   * Bande de modelé, dessinée à l'intérieur de la branche.
   *
   * Une branche est un cylindre : elle reçoit la lumière d'un côté et
   * s'assombrit de l'autre. Peinte d'un seul aplat, elle reste une découpe de
   * papier. Comme un tracé de canvas ne porte qu'une couleur, le volume se
   * construit en repassant la même courbe en plus étroit et décalé sur le
   * côté, une fois en clair et une fois en sombre.
   */
  shading?: BranchShading,
): void {
  const left: number[] = [];
  const right: number[] = [];

  for (let i = 0; i < spine.length; i += SPINE_STRIDE) {
    const x = spine[i];
    const y = spine[i + 1];
    const nx = spine[i + 2];
    const ny = spine[i + 3];
    const half = spine[i + 4];

    if (shading) {
      const band = half * shading.width;
      const center = half * shading.offset;
      left.push(x + nx * (center + band), y + ny * (center + band));
      right.push(x + nx * (center - band), y + ny * (center - band));
    } else {
      left.push(x + nx * half, y + ny * half);
      right.push(x - nx * half, y - ny * half);
    }
  }

  ctx.moveTo(left[0], left[1]);
  for (let i = 2; i < left.length; i += 2) ctx.lineTo(left[i], left[i + 1]);
  for (let i = right.length - 2; i >= 0; i -= 2) ctx.lineTo(right[i], right[i + 1]);
  ctx.closePath();
}

/**
 * Trace une branche fuselée entre deux points.
 *
 * `sway` écarte la courbe de sa trajectoire idéale. Sans lui, toutes les
 * branches d'une même fratrie décrivent exactement le même S et l'ensemble se
 * lit comme un diagramme ; avec lui, chacune part chercher sa place.
 */
function traceBranch(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w0: number,
  w1: number,
  segments: number,
  sway = 0,
  shading?: BranchShading,
): void {
  emitBranch(ctx, sampleBranch(x0, y0, x1, y1, w0, w1, segments, sway), shading);
}

/**
 * Les brindilles.
 *
 * Une branche qui va d'une personne à l'autre sans jamais rien porter d'autre
 * reste un trait de liaison : c'est le dessin d'un graphe, pas d'un arbre. Un
 * arbre, ça bourgeonne partout — de petits rameaux qui ne mènent nulle part,
 * qui n'ont pas de descendance et pas de raison d'être sinon qu'ils poussent.
 *
 * Elles sortent du bord du bois, pas de son axe, et repartent vers le haut :
 * une pousse cherche la lumière. Chacune est tirée du hachage de la personne
 * que la branche porte, donc toujours au même endroit.
 */
function traceSprigs(
  ctx: CanvasRenderingContext2D,
  seed: string,
  spine: number[],
  breeze: number,
  /**
   * Reçoit la pointe de chaque brindille tracée.
   *
   * Une brindille sans rien à son extrémité se lit comme un bâton cassé posé
   * contre la branche — exactement ce qu'elle n'est pas censée être. Un
   * bourgeon à la pointe suffit à la faire lire comme une pousse vivante ; il
   * est peint à part, dans la couleur du feuillage, donc collecté ici plutôt
   * que tracé sur-le-champ.
   */
  buds: Array<{ x: number; y: number; size: number; seed: string }>,
): void {
  const samples = spine.length / SPINE_STRIDE;
  if (samples < 4) return;
  // Sous une certaine section, la branche n'a pas de quoi porter un rameau : la
  // brindille serait plus épaisse que le bois dont elle sort.
  if (spine[SPINE_STRIDE + 4] * 2 < 7) return;

  const count = 1 + Math.floor(hashN(seed, 71) * 3);

  for (let k = 0; k < count; k += 1) {
    // Réparties le long de la seconde moitié : au ras de la fourche, une
    // brindille se perd dans le nœud.
    const t = 0.34 + ((k + 0.3 + hashN(seed, k * 5 + 72) * 0.6) / (count + 0.4)) * 0.58;
    const i = Math.min(samples - 2, Math.max(1, Math.round(t * (samples - 1)))) * SPINE_STRIDE;

    const half = spine[i + 4];
    const nx = spine[i + 2];
    const ny = spine[i + 3];
    const side = hashN(seed, k * 5 + 73) < 0.5 ? 1 : -1;

    const bx = spine[i] + nx * half * side * 0.6;
    const by = spine[i + 1] + ny * half * side * 0.6;

    // Une brindille a sa taille propre. Proportionnée à la branche qui la
    // porte, elle devenait une barre de bois sur les grosses branches — ce qui
    // pousse sur un tronc, ce sont des gourmands, et un gourmand est fin.
    const length = Math.min(half * (4.5 + hashN(seed, k * 5 + 74) * 7), ROW_HEIGHT * 0.5);
    // Vers l'extérieur, et vers le haut : la part verticale domine, sinon la
    // brindille pousse à l'horizontale comme une épine.
    const tipX = bx + nx * side * length * 0.72 + Math.sin(breeze * 1.4 + bx * 0.002) * length * 0.1;
    const tipY = by - length * (0.72 + hashN(seed, k * 5 + 75) * 0.5);

    emitBranch(
      ctx,
      sampleBranch(
        bx,
        by,
        tipX,
        tipY,
        Math.min(half * 0.42, 13),
        Math.min(half * 0.05, 1.6),
        5,
        length * 0.16 * side,
      ),
    );

    // Le bourgeon suit la taille de sa brindille : minuscule sur un gourmand
    // fin, un peu plus fourni sur une pousse qui sort du fût.
    buds.push({ x: tipX, y: tipY, size: Math.min(24, Math.max(5, half * 0.5)), seed: `${seed}!b${k}` });
  }
}

/**
 * Renflement à la jonction, entre le tronc et ses branches.
 *
 * Tracé en sens inverse des polygones de branches. Toutes ces formes partagent
 * un même chemin, rempli selon la règle du non-zéro : deux contours superposés
 * de sens contraires s'y annulent, et la jonction se troue au lieu de se
 * combler — un petit disque du fond apparaissait à chaque fourche.
 */
function traceKnot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, radius, 0, Math.PI * 2, true);
}

/**
 * Le balancement de la ramure sous le vent.
 *
 * Il ne déplace que les points de contrôle de la courbe, jamais ses extrémités :
 * une branche reste soudée à la fourche dont elle part et au portrait qu'elle
 * porte. Ce qui bouge, c'est son ventre — exactement ce que fait une branche
 * réelle, dont le point d'attache ne va nulle part.
 *
 * L'amplitude décroît avec ce que la branche porte. Une maîtresse branche qui
 * nourrit cent personnes ne bouge pas ; un rameau terminal oscille. C'est
 * l'inverse qui trahirait le procédé : un arbre dont le tronc ondule est une
 * animation, pas un arbre.
 *
 * La phase suit l'abscisse, comme dans l'herbe et le feuillage — toute la scène
 * partage une seule onde, si bien que le vent traverse le tableau au lieu de
 * secouer chaque élément dans son coin.
 */
function breathe(
  breeze: number,
  x: number,
  carried: number,
  reach: number,
  spacing: number,
): number {
  if (breeze === 0) return 0;
  const amplitude = Math.min(
    spacing * 0.05,
    (reach * 0.02 + ROW_HEIGHT * 0.022) / Math.sqrt(1 + carried),
  );
  return Math.sin(breeze * 0.9 + x * 0.0014) * amplitude;
}

function traceUnion(
  ctx: CanvasRenderingContext2D,
  union: LayoutUnion,
  weights: Map<string, number>,
  segments: number,
  /** Épaisseur minimale, en unités de monde : sans elle, les rameaux
   *  disparaîtraient sous le pixel dès qu'on s'éloigne. */
  floor: number,
  /** Phase de la brise, en secondes ; zéro pour une ramure immobile. */
  breeze: number,
  /** Bande de modelé, ou rien pour le corps plein de la branche. */
  shading?: BranchShading,
  /** En deçà de cette épaisseur, une branche ne reçoit pas de modelé : la
   *  bande y tiendrait dans moins d'un pixel et ne produirait qu'un liseré. */
  minShaded = 0,
  /**
   * Passe de décoration : au lieu du bois lui-même, on ne trace que ce qui
   * pousse dessus — brindilles, feuillage. Ces formes sont remplies à part :
   * superposées au bois dans un même chemin, leurs contours s'annuleraient par
   * endroits avec la règle du non-zéro, et la branche se trouerait à chaque
   * départ.
   *
   * Le décorateur reçoit le parcours de la branche — position, normale et
   * demi-épaisseur en chaque point — donc de quoi accrocher quelque chose
   * n'importe où le long du bois, à la bonne inclinaison.
   */
  decorate?: (spine: number[], seed: string) => void,
): void {
  const { partners, children } = union;
  if (partners.length === 0) return;

  const parentY = Math.min(...partners.map((p) => p.y));

  if (children.length === 0) return;

  // La fourche se déplace un peu d'une famille à l'autre : alignées à la même
  // altitude, toutes les divisions dessineraient une ligne d'horizon artificielle.
  const forkY = forkOffset(parentY) + jitter(union.id, 1, ROW_HEIGHT * 0.17);
  const startY =
    partners.length > 1 && union.adjacent
      ? portraitCenterY(parentY)
      : portraitTop(partners[0].y);

  let carried = 0;
  for (const child of children) carried += 1 + (weights.get(child.id) ?? 0);

  const trunkWidth = boneWidth(carried, floor);
  const shadeTrunk = shading && trunkWidth >= minShaded ? shading : undefined;

  // Tronc : du couple jusqu'à la fourche.
  //
  // Sans amincissement. Il s'affinait de dix pour cent en montant, si bien que
  // la fourche était plus étroite que les branches qui en partent : le bois
  // arrivait mince et repartait épais, et la jonction se lisait comme une
  // rupture. Une branche ne se rétrécit pas avant de se diviser.
  const spineTrunk = sampleBranch(
    union.anchorX,
    startY,
    union.anchorX + jitter(union.id, 2, trunkWidth * 0.18),
    forkY,
    trunkWidth,
    trunkWidth,
    5,
    jitter(union.id, 3, trunkWidth * 0.25),
  );
  if (decorate) {
    decorate(spineTrunk, `${union.id}!f`);
  } else {
    emitBranch(ctx, spineTrunk, shadeTrunk);
    // Le renflement de la fourche, plus large que le bois : c'est lui qui
    // rattrape les départs des branches et fait un nœud là où, sans lui, on
    // verrait trois formes se recouvrir.
    if (!shading) traceKnot(ctx, union.anchorX, forkY, trunkWidth * 0.62);
  }

  // Écart le plus serré entre deux enfants voisins : c'est lui qui borne la
  // liberté qu'on peut laisser à chaque branche.
  let spacing = Number.POSITIVE_INFINITY;
  for (let i = 1; i < children.length; i += 1) {
    spacing = Math.min(spacing, Math.abs(children[i].x - children[i - 1].x));
  }
  if (!Number.isFinite(spacing)) spacing = CARD_WIDTH * 2;

  for (const child of children) {
    const descendants = weights.get(child.id) ?? 0;
    const carriedByChild = 1 + descendants;
    // Épaisseur variée d'un rameau à l'autre : une fratrie parfaitement
    // régulière trahit le dessin automatique. La variation ne porte que sur le
    // départ — l'arrivée doit rester exacte, voir ci-dessous.
    //
    // Jamais plus large que la fourche d'où elle sort : au-delà, l'enfant
    // semblerait porter son parent.
    const width = Math.min(
      trunkWidth * 0.96,
      boneWidth(carriedByChild, floor) * (0.9 + hashN(child.id, 4) * 0.22),
    );
    // L'arrivée vaut exactement ce que la branche suivante emportera.
    //
    // C'est la règle qui rend l'arbre continu. Une branche s'arrête au portrait
    // de la personne qu'elle porte ; de ce portrait repart le bois de sa propre
    // descendance. Si les deux n'ont pas la même section, on voit un ressaut —
    // un gros tronc qui arrive, un fil qui repart — et les deux morceaux ne se
    // lisent plus comme la même branche. En terminant à l'épaisseur qu'attend
    // la suite, le bois traverse la personne au lieu de s'y interrompre.
    const tip = boneWidth(descendants, floor);
    const reach = Math.abs(cardCenterX(child.x) - union.anchorX);
    const spine = sampleBranch(
      union.anchorX,
      forkY,
      cardCenterX(child.x),
      portraitBottom(child.y),
      width,
      Math.min(width * 0.94, Math.max(tip, floor)),
      segments,
      // La déviation reste sous la moitié de l'écart entre deux enfants.
      //
      // Une branche qui s'écarte davantage passe devant celle de sa voisine :
      // les deux se croisent, et l'œil ne peut plus dire lequel des deux
      // rameaux mène à quel enfant. L'irrégularité doit rester une inflexion,
      // jamais un détour — une famille se lit d'abord, elle ne se devine pas.
      // Le terme constant est ce qui sauve les branches verticales.
      //
      // Quand l'enfant est à l'aplomb de ses parents, la déviation autorisée
      // valait la largeur du bois — quelques unités — et la branche montait au
      // fil à plomb. Dix rangées de ces traits parfaitement verticaux et
      // parallèles, et la cime redevient un graphique. Un arc de quelques
      // dizaines d'unités suffit à leur rendre leur bois.
      jitter(child.id, 5, Math.min(spacing * 0.32, reach * 0.06 + width + ROW_HEIGHT * 0.06)) +
        breathe(breeze, cardCenterX(child.x), carriedByChild, reach, spacing),
    );

    if (decorate) decorate(spine, child.id);
    else emitBranch(ctx, spine, shading && width >= minShaded ? shading : undefined);
  }
}

/**
 * Le pied de l'arbre : le fût, les racines, et les départs vers chaque lignée
 * fondatrice. Sans lui, les généalogies flottent ; avec lui, elles tiennent
 * ensemble et l'ensemble se lit comme un seul arbre.
 */
function traceTrunk(
  ctx: CanvasRenderingContext2D,
  trunk: TrunkLayout,
  segments: number,
  floor: number,
  shading?: BranchShading,
): void {
  if (trunk.roots.length === 0) return;

  // Le fût n'a pas besoin du plancher d'écran : il est déjà, et de loin, la
  // pièce la plus large de l'arbre.
  const width = trunk.width;
  const groundY = trunk.baseY - ROW_HEIGHT * 0.5;

  // Fût, du sol jusqu'à la naissance des premières branches.
  //
  // Il part d'un empattement, sous la ligne de terre : un tronc qui sort du sol
  // à section constante a l'air planté là comme un poteau. Mais deux segments
  // raccordés à une épaisseur commune, essayés d'abord pour refermer
  // l'évasement vite, donnaient pire : l'amincissement de `sampleBranch` suit
  // une courbe en S, plate à ses deux bouts. Recoller un second segment juste
  // après le premier, c'est recoller deux plats bout à bout — la largeur ne
  // bouge presque plus sur toute la jonction, exactement le plateau qui fait
  // lire une bouteille plutôt qu'un fût. Un seul segment, du sol jusqu'à la
  // fourche, laisse cette même courbe faire son travail une seule fois :
  // large et stable près du sol, puis un rétrécissement continu.
  const flare = width * 1.2;
  traceBranch(
    ctx,
    trunk.x,
    groundY + ROW_HEIGHT * 0.16,
    trunk.x,
    trunk.topY,
    flare,
    width * 0.52,
    22,
    width * 0.1,
    shading,
  );

  // Racines.
  //
  // Elles divergent sous le sol en s'affinant, ce qui ancre l'arbre au lieu de
  // le laisser posé sur une pointe. Elles étaient bien trop maigres pour ce
  // qu'elles portent — corrigé — mais aussi parfaitement droites, toutes issues
  // du même point : un éventail de rayons, ce qu'aucune racine n'a jamais été.
  //
  // Deux changements. Le départ de chacune est décalé le long de l'empattement,
  // pas planté au centre exact : neuf racines nées du même pixel dessinent une
  // étoile. Et chacune se coude une fois à mi-parcours — deux segments raccordés
  // à la même épaisseur, exactement comme une branche qui se prolonge — car un
  // seul arc de Bézier, aussi ample soit-il, se lit encore comme un rayon à
  // peine incurvé.
  const rootCount = 7;
  for (let i = 0; i < rootCount; i += 1) {
    const t = i / (rootCount - 1);
    const spread = (t - 0.5) * 2;
    const wobble = jitter('root', i, 0.28);
    const reach = width * (2.1 + Math.abs(spread) * 1.9) * (1 + wobble * 0.5);
    const rootWidth = width * (0.62 - Math.abs(spread) * 0.2);

    const startX = trunk.x + jitter('root-start', i, width * 0.2);
    const startY = groundY + ROW_HEIGHT * 0.1;
    const dx = (spread + wobble * 0.4) * reach;
    const dy = ROW_HEIGHT * (0.5 + Math.abs(spread) * 0.4);

    const bendT = 0.4 + hashN('root-bend', i) * 0.24;
    const midX = startX + dx * bendT + jitter('root-mid', i, Math.abs(dx) * 0.2);
    const midY = startY + dy * bendT * 0.72;
    const midWidth = Math.max(2.6, rootWidth * 0.52);
    const tipWidth = Math.max(1.4, rootWidth * 0.1);

    traceBranch(
      ctx,
      startX,
      startY,
      midX,
      midY,
      Math.max(3, rootWidth),
      midWidth,
      6,
      jitter('root-sway-a', i, Math.abs(dx) * 0.14),
      shading,
    );
    traceBranch(
      ctx,
      midX,
      midY,
      startX + dx,
      startY + dy,
      midWidth,
      tipWidth,
      6,
      jitter('root-sway-b', i, Math.abs(dx) * 0.12),
      shading,
    );
  }

  // Radicelles : le même geste, en plus fin, plus profond et bien moins
  // nombreux — ce sont elles qui font lire un enracinement plutôt qu'un
  // trépied, mais un buisson de vingt traits fait l'inverse : du bruit.
  const radicelleCount = 6;
  for (let i = 0; i < radicelleCount; i += 1) {
    const roll = hashN('radicelle', i);
    const spread = (hashN('radicelle-x', i) - 0.5) * 2;
    const start = width * spread * 0.85;
    traceBranch(
      ctx,
      trunk.x + start,
      groundY + ROW_HEIGHT * (0.12 + roll * 0.2),
      trunk.x + start + spread * width * (1.2 + roll * 1.6),
      trunk.baseY + ROW_HEIGHT * (0.35 + roll * 0.7),
      Math.max(2, width * (0.1 + roll * 0.1)),
      1.2,
      6,
      jitter('radicelle-s', i, width * 0.55),
      shading,
    );
  }

  // Départs vers les lignées fondatrices, épaisseur proportionnelle à ce que
  // chacune porte.
  let total = 0;
  for (const root of trunk.roots) total += root.weight;

  const trunkTop = width * 0.52;

  for (let i = 0; i < trunk.roots.length; i += 1) {
    const root = trunk.roots[i];
    const share = Math.max(0.08, root.weight / Math.max(1, total));
    // L'arrivée vaut ce que la lignée fondatrice emporte : c'est la même règle
    // de continuité que partout ailleurs dans la ramure, et c'est elle qui fait
    // que le fût, la maîtresse branche et la lignée se lisent d'un trait.
    const tip = boneWidth(root.weight, floor);
    // Le départ, lui, est calé sur le fût : une maîtresse branche quitte le
    // tronc en occupant une bonne part de sa section, puis s'affine.
    const w = Math.max(tip * 1.15, Math.min(trunkTop * 0.92, trunkTop * Math.sqrt(share)));
    traceBranch(
      ctx,
      trunk.x,
      trunk.topY,
      root.x,
      root.y,
      w,
      tip,
      Math.max(segments, 10),
      // Arquées vers l'extérieur : elles s'écartent d'abord, puis se redressent
      // sous leur lignée, au lieu de filer en ligne droite.
      (root.x - trunk.x) * 0.3 + jitter('founder', i, w * 4),
      shading,
    );
  }
}

/** Les brindilles du pied : sur le fût et sur les maîtresses branches. */
function traceTrunkSprigs(
  ctx: CanvasRenderingContext2D,
  trunk: TrunkLayout,
  floor: number,
  breeze: number,
  buds: Array<{ x: number; y: number; size: number; seed: string }>,
): void {
  if (trunk.roots.length === 0) return;
  const width = trunk.width;
  const groundY = trunk.baseY - ROW_HEIGHT * 0.5;

  traceSprigs(
    ctx,
    'fut',
    sampleBranch(trunk.x, groundY, trunk.x, trunk.topY, width * 1.34, width * 0.52, 20, width * 0.1),
    breeze,
    buds,
  );

  let total = 0;
  for (const root of trunk.roots) total += root.weight;
  const trunkTop = width * 0.52;

  for (let i = 0; i < trunk.roots.length; i += 1) {
    const root = trunk.roots[i];
    const share = Math.max(0.08, root.weight / Math.max(1, total));
    const tip = boneWidth(root.weight, floor);
    const w = Math.max(tip * 1.15, Math.min(trunkTop * 0.92, trunkTop * Math.sqrt(share)));
    traceSprigs(
      ctx,
      `souche-${i}`,
      sampleBranch(
        trunk.x,
        trunk.topY,
        root.x,
        root.y,
        w,
        tip,
        12,
        (root.x - trunk.x) * 0.3 + jitter('founder', i, w * 4),
      ),
      breeze,
      buds,
    );
  }
}

/**
 * Les liens de mariage.
 *
 * Dessinés dans leur propre passe, après le bois. Tracés avec les branches, ils
 * partageaient un chemin où le tronc de la descendance les recouvrait : un
 * couple avec enfants ne montrait aucune alliance, alors qu'un couple sans
 * descendance en montrait une. Or l'alliance est l'information la plus lue d'un
 * arbre après la filiation, et elle ne peut pas dépendre d'un ordre de tracé.
 *
 * Ils se distinguent aussi du bois par leur couleur : une union n'est pas une
 * branche, c'est un lien entre deux personnes.
 */
function drawMarriages(
  ctx: CanvasRenderingContext2D,
  unions: LayoutUnion[],
  palette: TreePalette,
  scale: number,
  dimmed: boolean,
): void {
  const height = Math.max(1.6, 3.4 / Math.max(scale, 0.25));
  let drawn = 0;

  ctx.beginPath();
  for (const union of unions) {
    const { partners } = union;
    if (partners.length < 2 || !union.adjacent) continue;

    const left = partners[0];
    const right = partners[partners.length - 1];
    const y = portraitCenterY(left.y);
    // D'un bord de portrait à l'autre : le lien relie les visages, pas les
    // boîtes qui les contiennent.
    const from = cardCenterX(left.x) + PORTRAIT_RADIUS - 1;
    const to = cardCenterX(right.x) - PORTRAIT_RADIUS + 1;
    if (to <= from) continue;

    ctx.moveTo(from, y - height / 2);
    ctx.lineTo(to, y - height / 2);
    ctx.lineTo(to, y + height / 2);
    ctx.lineTo(from, y + height / 2);
    ctx.closePath();
    drawn += 1;
  }

  if (drawn === 0) return;
  ctx.fillStyle = dimmed ? palette.dim : palette.marriage;
  ctx.fill();
}

function traceCross(ctx: CanvasRenderingContext2D, link: CrossLink): void {
  const ax = cardCenterX(link.a.x);
  const ay = portraitCenterY(link.a.y);
  const bx = cardCenterX(link.b.x);
  const by = portraitCenterY(link.b.y);
  const dip = Math.min(220, Math.abs(bx - ax) * 0.14 + 60);
  ctx.moveTo(ax, ay);
  ctx.bezierCurveTo(ax + (bx - ax) * 0.25, ay - dip, ax + (bx - ax) * 0.75, by - dip, bx, by);
}

/**
 * Feuillage.
 *
 * Il pousse là où la lignée s'arrête : une personne sans descendance connue est
 * l'extrémité d'un rameau, donc l'endroit exact où un arbre porte ses feuilles.
 * C'est ce qui donne à l'ensemble sa couronne, et au regard un moyen immédiat
 * de voir où l'arbre continue et où il s'achève.
 */
function drawFoliage(
  ctx: CanvasRenderingContext2D,
  params: DrawParams,
  scale: number,
): void {
  const { palette, weights, highlighted } = params;
  // Le plafond décide si la cime est une masse ou un verger.
  //
  // À très faible échelle, chaque touffe se réduisait à quelques pixels et les
  // familles restaient séparées par du vide : on lisait quarante petits arbres
  // alignés au lieu d'une couronne. En laissant les touffes grandir, elles se
  // recouvrent et le feuillage redevient continu — c'est le recouvrement, pas
  // la densité, qui fait une cime.
  const size = Math.max(14, Math.min(470, 23 / Math.max(scale, 0.02)));
  // De loin, une touffe fournie devient une masse illisible : on réduit le
  // nombre de feuilles à mesure que chacune perd en surface à l'écran.
  // En mouvement, une touffe de quatre feuilles suffit à tenir la silhouette.
  const perCluster = params.detailed ? (scale > 0.3 ? 15 : scale > 0.12 ? 13 : 11) : 5;

  // Trois plans de verdure. Un feuillage d'une seule teinte se lit comme une
  // tache : c'est l'écart entre les feuilles d'ombre, celles de plein jour et
  // celles que la lumière traverse qui lui donne son épaisseur. La répartition
  // vient du hachage, donc stable d'une image à l'autre.
  const back: NodePosition[] = [];
  const mid: NodePosition[] = [];
  const lit: NodePosition[] = [];
  // Le feuillage intérieur : celui que portent les personnes qui ont une
  // descendance, donc situées au cœur de l'arbre.
  const inner: NodePosition[] = [];

  // De près, chaque médaillon doit rester lisible et une couronne de plus
  // autour de chacun d'eux encombrerait la lecture. De loin, c'est l'inverse :
  // sans ce feuillage intérieur, la cime se réduit à des touffes isolées aux
  // extrémités et l'arbre ressemble à un verger de jeunes plants.
  const filling = scale < 0.32;

  for (const node of params.nodes) {
    if ((weights.get(node.id) ?? 0) > 0) {
      if (filling) inner.push(node);
      continue;
    }
    const roll = hashN(node.id, 99);
    if (roll < 0.38) back.push(node);
    else if (roll < 0.76) mid.push(node);
    else lit.push(node);
  }

  const paint = (
    group: NodePosition[],
    color: string,
    offset: number,
    alpha: number,
    scaling = 1,
  ): void => {
    if (group.length === 0) return;
    ctx.beginPath();
    for (const node of group) {
      // La même onde que dans l'herbe : le feuillage penche là où le vent
      // passe, avec un décalage de phase selon l'abscisse.
      const breeze =
        Math.sin(params.time * 0.9 + cardCenterX(node.x) * 0.0014) * size * 0.16;
      const x = cardCenterX(node.x) + jitter(node.id, 21, size * 0.22) + breeze;
      // Le décalage vertical casse l'alignement des rangées — toutes les
      // personnes d'une génération étant à la même altitude, un feuillage posé
      // à hauteur fixe dessine des lignes horizontales qui trahissent le plan.
      //
      // Il se mesure sur la taille de la touffe, jamais sur la hauteur d'une
      // génération : cette dernière vaut plusieurs centaines d'unités, et les
      // feuilles s'en allaient flotter loin de tout rameau.
      const y = portraitCenterY(node.y) + offset + jitter(node.id, 41, size * 0.28);
      // La couronne enveloppe le portrait : elle part du bord du médaillon et
      // s'ouvre vers l'extérieur, si bien que la personne apparaît posée dans
      // son feuillage plutôt que coiffée par lui.
      traceLeafCrown(
        ctx,
        node.id,
        x,
        y,
        Math.max(PORTRAIT_RADIUS * 1.05, size * 0.26) * scaling,
        size * scaling,
        Math.max(4, Math.round(perCluster * scaling)),
      );
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  const faded = params.hasSelection ? 0.3 : 1;
  // Le feuillage intérieur d'abord, au fond : il comble les vides entre les
  // rameaux sans jamais passer devant les extrémités, qui restent ce qu'on doit
  // voir. Vu de loin, c'est lui qui fait la masse — sans lui, la cime n'est
  // qu'une rangée de tiges nues coiffées de petites touffes.
  if (inner.length) paint(inner, palette.leafAlt, size * 0.16, 0.74 * faded, 0.92);
  // Du fond vers la lumière : le plan reculé est décalé vers le bas, ce qui
  // creuse la couronne au lieu de l'aplatir.
  paint(back, palette.leafAlt, size * 0.34, 0.7 * faded);
  paint(mid, palette.leaf, 0, 0.88 * faded);
  if (params.detailed) paint(lit, palette.leafLit, -size * 0.2, 0.86 * faded);
  else paint(lit, palette.leaf, 0, 0.86 * faded);

  // La sélection garde son feuillage en pleine couleur, sinon la branche
  // désignée paraîtrait morte au milieu d'un arbre vivant.
  if (params.hasSelection) {
    const accent = params.nodes.filter(
      (node) => highlighted.has(node.id) && (weights.get(node.id) ?? 0) === 0,
    );
    paint(accent, palette.leafLit, 0, 1);
  }
}

export function drawTree(ctx: CanvasRenderingContext2D, params: DrawParams): void {
  const { transform, width, height, dpr, palette, highlighted, hasSelection, weights } = params;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(
    transform.scale * dpr,
    0,
    0,
    transform.scale * dpr,
    transform.x * dpr,
    transform.y * dpr,
  );

  const scale = transform.scale;
  // Loin, une branche n'occupe qu'une fraction de pixel : inutile de la
  // détailler, deux segments suffisent et divisent le coût par cinq.
  // Vingt-quatre segments par branche donnent des courbes parfaitement lisses
  // à l'arrêt, mais doublent le nombre de points à tracer : en mouvement, la
  // moitié suffit, l'œil ne suivant pas les facettes d'une branche qui défile.
  const segments = params.detailed
    ? scale > 0.4
      ? 24
      : scale > 0.2
        ? 12
        : 4
    : scale > 0.4
      ? 10
      : 5;
  const showCouples = scale > 0.1;
  // Le plancher d'épaisseur, exprimé en pixels d'écran puis converti en unités
  // de monde : un rameau terminal ne descend jamais sous un pixel et demi, quel
  // que soit l'éloignement. Plafonné, sans quoi une vue très lointaine
  // épaissirait tout jusqu'à souder la ramure en une masse.
  const floor = Math.min(72, 1.5 / Math.max(scale, 0.002));

  // Dégradé du bois : sombre et chaud à la racine, clair vers les rameaux.
  // Il est construit en coordonnées monde, donc suit l'arbre et non l'écran.
  const wood = ctx.createLinearGradient(0, params.bounds.maxY, 0, params.bounds.minY);
  wood.addColorStop(0, palette.trunk);
  wood.addColorStop(1, palette.twig);

  const normal: LayoutUnion[] = [];
  const accent: LayoutUnion[] = [];
  for (const union of params.unions) {
    if (highlighted.has(union.id)) accent.push(union);
    else normal.push(union);
  }

  // Le cadre visible, en unités de monde : décor et atmosphère ne sèment que
  // ce qui a une chance d'être vu.
  const rect = visibleRect(transform, { width, height }, 400);
  const view = visibleRect(transform, { width, height }, 0);
  const air: AmbienceParams = {
    palette,
    scale,
    time: params.time,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    ground: groundLevel(params.trunk),
    canopyTop: params.bounds.minY,
    trunkX: params.trunk.x,
    canopyHalfWidth: Math.max(
      (params.bounds.maxX - params.bounds.minX) / 2,
      ROW_HEIGHT,
    ),
    viewTop: view.top,
    viewHeight: view.bottom - view.top,
  };

  // Passe 0 : le décor, sous tout le reste.
  //
  // Un arbre posé sur du vide reste un schéma : rien ne dit où il pousse ni à
  // quelle échelle. La clairière d'abord, puis ce qui s'y trouve.
  //
  // Il est peint même quand une lignée est sélectionnée. On l'avait d'abord
  // suspendu pour concentrer le regard, mais choisir quelqu'un faisait alors
  // disparaître le ciel et la terre sous ses pieds : la fiche s'ouvrait sur un
  // arbre qui flottait dans le vide. Le décor ne dispute rien à la lignée
  // accentuée — il est derrière, et bien plus pâle qu'elle.
  {
    const scenery = {
      trunk: params.trunk,
      palette,
      scale,
      time: params.time,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
    };
    // Le ciel d'abord : tout le reste se pose devant.
    drawClouds(ctx, air);
    drawGround(ctx, scenery);
    drawSoilGrain(ctx, scenery);
    // Les flaques de lumière passent sous l'herbe et les pierres : elles
    // éclairent la terre, elles ne se posent pas dessus.
    drawDapples(ctx, scenery);
    // Le sous-bois ne se distingue plus en vue lointaine : inutile de le semer.
    if (scale > 0.028) {
      drawStones(ctx, scenery);
      drawUndergrowth(ctx, scenery);
    }
  }

  // Passe 1 : le pied et toute la ramure, en un seul remplissage.
  ctx.beginPath();
  traceTrunk(ctx, params.trunk, segments, floor);
  for (const union of normal) traceUnion(ctx, union, weights, segments, floor, params.time);
  ctx.fillStyle = hasSelection ? palette.dim : wood;
  ctx.fill();

  // Passe 2 : le modelé du bois.
  //
  // Une branche est un cylindre. Peinte d'un seul aplat, elle reste une découpe
  // de papier : c'est la bande claire du côté de la lumière et l'ombre du côté
  // opposé qui lui donnent son volume. Les deux ne sont dessinées qu'au-delà
  // d'un certain zoom — sous deux pixels d'épaisseur à l'écran, elles ne
  // produisent qu'un bruit sale sur la silhouette.
  const boneOnScreen = Math.max(26, floor) * scale;
  // Le modelé, y compris pendant le déplacement.
  //
  // Il fut un temps suspendu au-delà de soixante branches visibles : le
  // supprimer aplatissait tout l'arbre à chaque geste, et la molette étant
  // maintenant le zoom lui-même, cet aplatissement se voyait à chaque
  // exploration. Mesuré : sur une vue d'ensemble, `boneOnScreen` est déjà trop
  // fin pour déclencher le relief, donc rien à perdre à l'y autoriser ; sur une
  // vue à soixante branches, le garder coûte trois images par seconde sur la
  // trentaine disponible — largement moins cher que ce qu'il évite de perdre.
  const shaded = boneOnScreen > 2.4;

  // Épaisseur, à l'écran, de la plus grosse branche visible.
  //
  // C'est elle qui décide de la finesse du dégradé, pas une épaisseur moyenne :
  // le nombre de paliers nécessaires dépend de la surface sur laquelle le
  // fondu s'étale. Une branche de trois cents pixels laisse voir chaque marche
  // là où une branche de trente n'en montre aucune.
  let heaviest = 0;
  for (const node of params.nodes) heaviest = Math.max(heaviest, weights.get(node.id) ?? 0);
  const widestOnScreen = Math.max(boneOnScreen, thickness(heaviest) * scale);

  /** Pose le relief cylindrique sur une liste de branches. */
  const paintRelief = (list: LayoutUnion[], withTrunk: boolean): void => {
    // Seuil exprimé en unités de monde pour valoir quatre pixels à l'écran.
    const minShaded = 4 / scale;

    const paintBand = (band: BranchShading, color: string): void => {
      ctx.beginPath();
      if (withTrunk) traceTrunk(ctx, params.trunk, segments, floor, band);
      for (const union of list) {
        traceUnion(ctx, union, weights, segments, floor, params.time, band, minShaded);
      }
      ctx.fillStyle = color;
      ctx.fill();
    };

    // De près, le relief se construit en marches successives.
    //
    // Un cylindre n'a pas d'arête. À quelques pixels d'épaisseur la marche
    // entre le clair et le sombre ne se voit pas, mais dès que la branche
    // occupe une bonne part de l'écran, deux aplats à bord franc se lisent
    // comme un ruban peint. Quatre bandes de plus en plus étroites et de plus
    // en plus opaques accumulent leurs transparences en un dégradé — c'est le
    // seul moyen d'obtenir un fondu quand chaque tracé ne porte qu'une couleur.
    // Elles ne coûtent que là où il ne reste plus grand-chose à dessiner.
    //
    // Le nombre de marches suit l'éloignement : trois suffisent quand la branche
    // fait trente pixels, il en faut sept quand elle en fait trois cents, sinon
    // on distingue chaque palier. Elles ne coûtent que là où il ne reste plus
    // que quelques branches à l'écran.
    // Le fondu progressif, lui, n'a lieu qu'au repos : c'est un raffinement de
    // contemplation, et il vaut à lui seul plusieurs remplissages.
    const steps = !params.detailed
      ? 0
      : widestOnScreen > 260
        ? 8
        : widestOnScreen > 90
          ? 5
          : widestOnScreen > 26
            ? 3
            : 0;
    for (let k = 0; k < steps; k += 1) {
      const span = 0.92 - (k * 0.42) / steps;
      ctx.globalAlpha = 0.5 / steps + k * (0.24 / steps);
      paintBand({ width: span, offset: 0.92 - span * 0.62 }, palette.woodShade);
      paintBand({ width: span * 0.84, offset: -(0.92 - span * 0.62) }, palette.woodLight);
    }
    ctx.globalAlpha = 1;

    // Du plus bas au plus haut du relief : l'ombre, la face éclairée, puis un
    // filet vif sur l'arête. Ce dernier trait est ce qui donne au bois son
    // poli — sans lui, le cylindre reste mat et un peu terreux.
    paintBand({ width: 0.42, offset: 0.52 }, palette.woodShade);
    paintBand({ width: 0.3, offset: -0.5 }, palette.woodLight);
    if (boneOnScreen > 5) paintBand({ width: 0.1, offset: -0.66 }, palette.woodSheen);
  };

  if (shaded && !hasSelection) paintRelief(normal, true);

  // Passe 2 bis : les brindilles.
  //
  // Remplies à part, après le modelé : superposées au bois dans le même chemin,
  // leurs contours s'annuleraient par endroits — la règle du non-zéro fait un
  // trou là où deux formes de sens contraires se recouvrent. Elles ne
  // paraissent qu'au-delà d'une certaine épaisseur à l'écran : plus fines que
  // le pixel, elles ne feraient qu'un duvet sale sur la silhouette.
  if (params.detailed && !hasSelection && boneOnScreen > 9) {
    const buds: Array<{ x: number; y: number; size: number; seed: string }> = [];

    ctx.beginPath();
    traceTrunkSprigs(ctx, params.trunk, floor, params.time, buds);
    for (const union of normal) {
      traceUnion(ctx, union, weights, segments, floor, params.time, undefined, 0, (spine, seed) =>
        traceSprigs(ctx, seed, spine, params.time, buds),
      );
    }
    ctx.fillStyle = wood;
    ctx.fill();
    // Un rameau de l'année est plus clair que le bois dont il sort. Sans ce
    // second passage, la brindille prend la teinte sombre du bas de l'arbre et
    // se lit comme une fissure sur la branche plutôt que comme une pousse.
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = palette.woodLight;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Un bourgeon à chaque pointe.
    //
    // Sans lui, une brindille est un trait qui s'arrête dans le vide — et un
    // trait qui s'arrête dans le vide se lit comme cassé, pas comme vivant.
    // Peint à part, en couleur de feuillage : superposé au bois dans le même
    // remplissage, il en aurait pris la teinte.
    if (buds.length) {
      ctx.beginPath();
      for (const bud of buds) {
        traceLeafCrown(ctx, bud.seed, bud.x, bud.y, bud.size * 0.4, bud.size, 3);
      }
      ctx.fillStyle = palette.leafAlt;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Passe 3 : l'écorce du fût. Seulement quand elle est assez large à l'écran
  // pour se lire — en dessous, ce ne serait qu'un bruit gris sur la silhouette.
  const trunkOnScreen = params.trunk.width * scale;
  if (params.detailed && trunkOnScreen > 110 && !hasSelection) {
    ctx.beginPath();
    traceBark(
      ctx,
      'ecorce',
      params.trunk.x,
      params.trunk.topY,
      params.trunk.baseY - ROW_HEIGHT * 0.5,
      params.trunk.width,
      11,
    );
    ctx.fillStyle = palette.bark;
    ctx.fill();
  }

  // Passe 4 : les alliances, par-dessus le bois pour ne jamais être recouvertes.
  if (showCouples) {
    drawMarriages(ctx, params.unions, palette, scale, hasSelection);
  }

  // Passe 5 : mariages entre branches éloignées, en fil léger.
  if (params.crossLinks.length && scale > 0.12) {
    ctx.save();
    ctx.setLineDash([7 / Math.max(scale, 0.3), 8 / Math.max(scale, 0.3)]);
    ctx.beginPath();
    for (const link of params.crossLinks) traceCross(ctx, link);
    ctx.strokeStyle = hasSelection ? palette.dim : palette.cross;
    ctx.lineWidth = Math.max(1, 1.6 / Math.max(scale, 0.35));
    ctx.stroke();
    ctx.restore();
  }

  // Passe 5 bis : le feuillage des longues branches.
  //
  // Le feuillage ne pousse qu'aux extrémités, là où vivent les personnes sans
  // descendance. Une branche qui traverse la moitié de l'arbre pour aller
  // chercher une famille éloignée reste alors un long fil nu, et la silhouette
  // de l'arbre se hérisse de rayons. Quelques touffes réparties le long du bois
  // suffisent : la branche redevient une branche feuillue, et le contour de la
  // cime se referme.
  //
  // Seulement de loin, et seulement sur les branches assez longues : de près,
  // le feuillage se lit personne par personne, et une touffe au milieu de nulle
  // part ne voudrait plus rien dire.
  if (scale < 0.34 && !hasSelection) {
    const leafSize = Math.max(14, Math.min(470, 23 / Math.max(scale, 0.02)));
    const minLength = ROW_HEIGHT * 1.1;

    // Pré-tri, avant toute géométrie : une union dont aucun enfant n'est loin
    // n'a aucune branche à garnir, et il est inutile de recalculer ses courbes
    // pour s'en apercevoir. Sur la vue d'ensemble, cela ramène le travail d'un
    // millier de branches à la trentaine qui le mérite.
    const reaching = normal.filter((union) =>
      union.children.some(
        (child) => Math.abs(cardCenterX(child.x) - union.anchorX) > ROW_HEIGHT * 0.75,
      ),
    );

    ctx.beginPath();
    for (const union of reaching) {
      traceUnion(ctx, union, weights, segments, floor, params.time, undefined, 0, (spine, seed) => {
        const samples = spine.length / SPINE_STRIDE;
        if (samples < 3) return;
        const span = Math.hypot(
          spine[(samples - 1) * SPINE_STRIDE] - spine[0],
          spine[(samples - 1) * SPINE_STRIDE + 1] - spine[1],
        );
        if (span < minLength) return;

        // Moitié moins de touffes, et moitié moins de feuilles par touffe,
        // pendant un déplacement : la silhouette tient, le coût s'efface.
        const count = Math.min(params.detailed ? 4 : 2, 1 + Math.floor(span / minLength));
        for (let k = 0; k < count; k += 1) {
          const t = (k + 0.5 + jitter(seed, k + 31, 0.3)) / count;
          const i = Math.min(samples - 1, Math.max(0, Math.round(t * (samples - 1)))) * SPINE_STRIDE;
          const side = hashN(seed, k + 41) < 0.5 ? 1 : -1;
          const reach = spine[i + 4] + leafSize * 0.22;
          traceLeafCrown(
            ctx,
            `${seed}!f${k}`,
            spine[i] + spine[i + 2] * side * reach,
            spine[i + 1] + spine[i + 3] * side * reach,
            leafSize * 0.24,
            leafSize * 0.82,
            params.detailed ? 8 : 4,
          );
        }
      });
    }
    ctx.fillStyle = palette.leafAlt;
    ctx.globalAlpha = params.detailed ? 0.66 : 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Passe 6 : le feuillage, posé sur la ramure.
  if (params.nodes.length) drawFoliage(ctx, params, scale);

  // Passe 6 bis : ce qui flotte devant l'arbre.
  //
  // Après le feuillage, donc devant lui : une poussière qui passerait derrière
  // les feuilles ne serait plus dans l'air, elle serait dans l'arbre.
  if (!hasSelection) {
    drawBirds(ctx, air);
    drawPetals(ctx, air);
    drawMotes(ctx, air);
  }

  // Passe 7 : la lignée sélectionnée, par-dessus.
  //
  // Sans halo. Une lignée traverse souvent tout le plan — un aïeul peut être à
  // des milliers d'unités de sa descendance — et le flou d'un halo étalait ces
  // branches en longs traits lumineux qui barraient l'écran et se voyaient au
  // travers des panneaux. La couleur seule suffit à désigner la lignée, sans la
  // faire traîner.
  if (accent.length) {
    ctx.beginPath();
    for (const union of accent) traceUnion(ctx, union, weights, segments, floor, params.time);


    // Le surlignage s'éteint en s'éloignant de la personne désignée.
    //
    // Une lignée s'étend sur tout le plan : un aïeul peut être à des milliers
    // d'unités de sa descendance, et sa branche traverse alors l'écran entier
    // en un long trait qui se voit jusque sous les panneaux. Le dégradé garde
    // la couleur là où elle informe — autour de la personne — et la laisse
    // partir là où elle ne fait plus que traîner.
    if (params.focus) {
      // Calibré sur la vue, pas sur l'arbre : un rayon exprimé en unités de
      // monde dépasse l'écran dès qu'on est un peu zoomé, et le dégradé
      // n'atténue alors plus rien.
      const reach = Math.min(ROW_HEIGHT * 3.2, (width / scale) * 0.4);
      const glow = ctx.createRadialGradient(
        params.focus.x,
        params.focus.y,
        0,
        params.focus.x,
        params.focus.y,
        reach,
      );
      glow.addColorStop(0, palette.highlight);
      glow.addColorStop(0.55, palette.highlight);
      glow.addColorStop(1, fade(palette.highlight));
      ctx.fillStyle = glow;
    } else {
      ctx.fillStyle = palette.highlight;
    }
    ctx.fill();

    // Et le même relief que sur le reste du bois. La couleur seule aplatissait
    // la lignée : une maîtresse branche large de cent unités devenait un ruban
    // posé sur le dessin. Avec son ombre et sa face éclairée, elle reste une
    // branche — simplement, c'est celle qu'on regarde.
    if (shaded) paintRelief(accent, false);
  }
}

export interface CanopyParams {
  nodes: NodePosition[];
  weights: Map<string, number>;
  highlighted: Set<string>;
  hasSelection: boolean;
  palette: TreePalette;
  scale: number;
}

/**
 * Marques des personnes en vue éloignée.
 *
 * Trop loin pour monter des cartes, l'arbre se lit à sa silhouette : chaque
 * personne qui porte une lignée devient un point de la couleur du bois. Les
 * extrémités, elles, sont déjà rendues par le feuillage.
 */
export function drawCanopy(ctx: CanvasRenderingContext2D, params: CanopyParams): void {
  const { nodes, weights, palette, highlighted } = params;
  const radius = Math.max(2.2, Math.min(48, 2.6 / Math.max(params.scale, 0.004)));
  const alpha = params.hasSelection ? 0.28 : 0.75;

  const wood: NodePosition[] = [];
  const accent: NodePosition[] = [];

  for (const node of nodes) {
    if (highlighted.has(node.id)) accent.push(node);
    else if ((weights.get(node.id) ?? 0) > 0) wood.push(node);
  }

  const paint = (group: NodePosition[], color: string, size: number, opacity: number): void => {
    if (group.length === 0) return;
    ctx.beginPath();
    for (const node of group) {
      const x = node.x + CARD_WIDTH / 2;
      const y = node.y + CARD_HEIGHT / 2;
      ctx.moveTo(x + size, y);
      ctx.arc(x, y, size, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  paint(wood, palette.node, radius * 0.8, alpha);
  paint(accent, palette.highlight, radius * 1.4, 1);
}
