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
import { hashN, jitter, traceBark, traceLeafCluster } from './organic';
import type { Transform } from './viewport';

export interface TreePalette {
  /** Sol sur lequel l'arbre est planté. */
  ground: string;
  /** Ombre portée au pied du tronc. */
  groundShade: string;
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
  // Le plafond est calé sous la largeur d'un médaillon : au-delà, la branche
  // cesse d'être une branche et devient une bande qui écrase le portrait.
  return Math.min(34, 1.7 + 1.45 * Math.sqrt(descendants));
}

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
  const rise = Math.max(Math.abs(dy) * 0.55, Math.min(Math.abs(dx) * 0.4, Math.abs(dy) * 1.9));
  const lift = dy < 0 ? -rise : rise;

  const c1x = x0 + sway;
  const c1y = y0 + lift;
  const c2x = x1 - sway * 0.45;
  const c2y = y1 - dy * 0.55;

  const left: number[] = [];
  const right: number[] = [];

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
    const nx = -ty / length;
    const ny = tx / length;

    // L'amincissement suit une courbe, pas une droite : le renflement reste
    // près du départ, comme au départ d'une vraie branche.
    const half = (w0 + (w1 - w0) * (t * t * (3 - 2 * t))) / 2;

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

function traceUnion(
  ctx: CanvasRenderingContext2D,
  union: LayoutUnion,
  weights: Map<string, number>,
  segments: number,
  /** Épaissit la ramure quand on s'éloigne, sans quoi elle disparaîtrait. */
  boost: number,
  /** Bande de modelé, ou rien pour le corps plein de la branche. */
  shading?: BranchShading,
  /** En deçà de cette épaisseur, une branche ne reçoit pas de modelé : la
   *  bande y tiendrait dans moins d'un pixel et ne produirait qu'un liseré. */
  minShaded = 0,
): void {
  const { partners, children } = union;
  if (partners.length === 0) return;

  const parentY = Math.min(...partners.map((p) => p.y));

  if (children.length === 0) return;

  // La fourche se déplace un peu d'une famille à l'autre : alignées à la même
  // altitude, toutes les divisions dessineraient une ligne d'horizon artificielle.
  const forkY = forkOffset(parentY) + jitter(union.id, 1, ROW_HEIGHT * 0.06);
  const startY =
    partners.length > 1 && union.adjacent
      ? portraitCenterY(parentY)
      : portraitTop(partners[0].y);

  let carried = 0;
  for (const child of children) carried += 1 + (weights.get(child.id) ?? 0);

  const trunkWidth = thickness(carried) * boost;
  const shadeTrunk = shading && trunkWidth >= minShaded ? shading : undefined;

  // Tronc : du couple jusqu'à la fourche.
  traceBranch(
    ctx,
    union.anchorX,
    startY,
    union.anchorX + jitter(union.id, 2, trunkWidth * 0.35),
    forkY,
    trunkWidth,
    trunkWidth * 0.9,
    4,
    jitter(union.id, 3, trunkWidth * 0.5),
    shadeTrunk,
  );
  if (!shading) traceKnot(ctx, union.anchorX, forkY, (trunkWidth * 0.9) / 2);

  for (const child of children) {
    const carriedByChild = 1 + (weights.get(child.id) ?? 0);
    // Épaisseur variée d'un rameau à l'autre : une fratrie parfaitement
    // régulière trahit le dessin automatique.
    const width = thickness(carriedByChild) * boost * (0.88 + hashN(child.id, 4) * 0.28);
    const reach = Math.abs(cardCenterX(child.x) - union.anchorX);
    traceBranch(
      ctx,
      union.anchorX,
      forkY,
      cardCenterX(child.x),
      portraitBottom(child.y),
      width,
      width * 0.62,
      segments,
      // La déviation croît avec la portée : une branche qui va loin s'arque,
      // une branche courte reste droite.
      jitter(child.id, 5, Math.min(ROW_HEIGHT * 0.22, reach * 0.16 + width * 2)),
      shading && width >= minShaded ? shading : undefined,
    );
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
  boost: number,
  shading?: BranchShading,
): void {
  if (trunk.roots.length === 0) return;

  // Le fût ne reçoit presque pas la compensation de zoom : elle existe pour
  // rendre visibles les rameaux d'un pixel, alors que le tronc est déjà la
  // pièce la plus large de l'arbre. L'y appliquer en fait une masse qui écrase
  // toute la ramure.
  const width = trunk.width * Math.min(boost, 1.25);
  const groundY = trunk.baseY - ROW_HEIGHT * 0.5;

  // Fût, du sol jusqu'à la naissance des premières branches.
  traceBranch(ctx, trunk.x, groundY, trunk.x, trunk.topY, width, width * 0.74, 18, width * 0.12, shading);

  // Racines : elles divergent sous le sol en s'affinant, ce qui ancre l'arbre
  // au lieu de le laisser posé sur une pointe.
  const rootCount = 7;
  for (let i = 0; i < rootCount; i += 1) {
    const t = i / (rootCount - 1);
    const spread = (t - 0.5) * 2;
    const wobble = jitter('root', i, 0.24);
    // Emprise au sol bornée à quelques largeurs de fût : proportionnelle à une
    // épaisseur déjà compensée, elle balayait tout l'écran.
    const reach = width * (1.5 + Math.abs(spread) * 1.3) * (1 + wobble * 0.5);
    const rootWidth = width * (0.44 - Math.abs(spread) * 0.17);
    traceBranch(
      ctx,
      trunk.x,
      groundY,
      trunk.x + (spread + wobble * 0.4) * reach,
      trunk.baseY + Math.abs(spread) * ROW_HEIGHT * 0.16,
      Math.max(2, rootWidth),
      1.5,
      6,
      jitter('root-sway', i, width * 0.5),
      shading,
    );
  }

  // Départs vers les lignées fondatrices, épaisseur proportionnelle à ce que
  // chacune porte.
  let total = 0;
  for (const root of trunk.roots) total += root.weight;

  for (let i = 0; i < trunk.roots.length; i += 1) {
    const root = trunk.roots[i];
    const share = Math.max(0.08, root.weight / Math.max(1, total));
    // Nettement plus fines que le fût : ce sont déjà des branches, et une
    // maîtresse branche aussi épaisse que le tronc n'existe pas.
    const w = Math.max(3, width * Math.sqrt(share) * 0.5);
    traceBranch(
      ctx,
      trunk.x,
      trunk.topY,
      root.x,
      root.y,
      w,
      w * 0.7,
      Math.max(segments, 10),
      // Arquées vers l'extérieur : elles s'écartent d'abord, puis se redressent
      // sous leur lignée, au lieu de filer en ligne droite.
      (root.x - trunk.x) * 0.3 + jitter('founder', i, w * 4),
      shading,
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
  const size = Math.max(14, Math.min(270, 23 / Math.max(scale, 0.02)));
  // De loin, une touffe fournie devient une masse illisible : on réduit le
  // nombre de feuilles à mesure que chacune perd en surface à l'écran.
  // En mouvement, une touffe de quatre feuilles suffit à tenir la silhouette.
  const perCluster = params.detailed ? (scale > 0.3 ? 14 : scale > 0.12 ? 11 : 9) : 4;

  // Trois plans de verdure. Un feuillage d'une seule teinte se lit comme une
  // tache : c'est l'écart entre les feuilles d'ombre, celles de plein jour et
  // celles que la lumière traverse qui lui donne son épaisseur. La répartition
  // vient du hachage, donc stable d'une image à l'autre.
  const back: NodePosition[] = [];
  const mid: NodePosition[] = [];
  const lit: NodePosition[] = [];

  for (const node of params.nodes) {
    if ((weights.get(node.id) ?? 0) > 0) continue;
    const roll = hashN(node.id, 99);
    if (roll < 0.38) back.push(node);
    else if (roll < 0.76) mid.push(node);
    else lit.push(node);
  }

  const paint = (group: NodePosition[], color: string, offset: number, alpha: number): void => {
    if (group.length === 0) return;
    ctx.beginPath();
    for (const node of group) {
      const x = cardCenterX(node.x) + jitter(node.id, 21, size * 0.5);
      // Le décalage vertical casse l'alignement des rangées — toutes les
      // personnes d'une génération étant à la même altitude, un feuillage posé
      // à hauteur fixe dessine des lignes horizontales qui trahissent le plan.
      //
      // Il se mesure sur la taille de la touffe, jamais sur la hauteur d'une
      // génération : cette dernière vaut plusieurs centaines d'unités, et les
      // feuilles s'en allaient flotter loin de tout rameau.
      const y =
        portraitTop(node.y) - size * 0.3 + offset + jitter(node.id, 41, size * 1.1);
      traceLeafCluster(ctx, node.id, x, y, size, perCluster);
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  const faded = params.hasSelection ? 0.3 : 1;
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

/**
 * Le sol, et l'ombre que l'arbre y projette.
 *
 * Sans eux l'arbre flotte : rien n'indique où il est planté, et le regard n'a
 * aucun repère pour juger de sa hauteur. Une bande qui s'estompe vers le haut
 * suffit — un aplat franc ferait décor de théâtre.
 */
function drawGround(ctx: CanvasRenderingContext2D, params: DrawParams): void {
  const { trunk, palette, bounds } = params;
  if (trunk.roots.length === 0) return;

  const groundY = trunk.baseY - ROW_HEIGHT * 0.5;

  // Une ellipse, pas une bande : un rectangle, si large soit-il, finit par
  // montrer ses deux arêtes verticales au milieu du vide. Le dégradé radial
  // s'éteint dans toutes les directions à la fois.
  const reach = Math.max(bounds.maxX - bounds.minX, ROW_HEIGHT * 8) * 0.62;
  const flatten = (ROW_HEIGHT * 1.5) / reach;

  const paintEllipse = (radius: number, fill: string | CanvasGradient): void => {
    ctx.save();
    ctx.translate(trunk.x, groundY);
    ctx.scale(1, flatten);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  };

  // Le dégradé est construit dans le repère écrasé, donc en cercle : c'est la
  // mise à l'échelle qui lui donne sa forme de clairière.
  const soil = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
  soil.addColorStop(0, palette.ground);
  soil.addColorStop(0.55, palette.ground);
  soil.addColorStop(1, 'transparent');
  paintEllipse(reach, soil);

  // Ombre portée, resserrée au pied du fût.
  const shadowReach = Math.max(trunk.width * 7, ROW_HEIGHT);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowReach);
  shade.addColorStop(0, palette.groundShade);
  shade.addColorStop(1, 'transparent');
  paintEllipse(shadowReach, shade);
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
  // Calibré sur l'écart entre deux personnes voisines : au-delà, les branches
  // fusionnent en masses pleines et l'arbre perd sa ramure.
  const boost = Math.min(13, Math.max(1, 0.3 / scale));

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

  // Passe 0 : le sol, sous tout le reste.
  if (!hasSelection) drawGround(ctx, params);

  // Passe 1 : le pied et toute la ramure, en un seul remplissage.
  ctx.beginPath();
  traceTrunk(ctx, params.trunk, segments, boost);
  for (const union of normal) traceUnion(ctx, union, weights, segments, boost);
  ctx.fillStyle = hasSelection ? palette.dim : wood;
  ctx.fill();

  // Passe 2 : le modelé du bois.
  //
  // Une branche est un cylindre. Peinte d'un seul aplat, elle reste une découpe
  // de papier : c'est la bande claire du côté de la lumière et l'ombre du côté
  // opposé qui lui donnent son volume. Les deux ne sont dessinées qu'au-delà
  // d'un certain zoom — sous deux pixels d'épaisseur à l'écran, elles ne
  // produisent qu'un bruit sale sur la silhouette.
  const boneOnScreen = 26 * boost * scale;
  if (params.detailed && boneOnScreen > 2.4 && !hasSelection) {
    // Seuil exprimé en unités de monde pour valoir quatre pixels à l'écran.
    const minShaded = 4 / scale;

    const paintBand = (band: BranchShading, color: string): void => {
      ctx.beginPath();
      traceTrunk(ctx, params.trunk, segments, boost, band);
      for (const union of normal) {
        traceUnion(ctx, union, weights, segments, boost, band, minShaded);
      }
      ctx.fillStyle = color;
      ctx.fill();
    };

    // Du plus bas au plus haut du relief : l'ombre, la face éclairée, puis un
    // filet vif sur l'arête. Ce dernier trait est ce qui donne au bois son
    // poli — sans lui, le cylindre reste mat et un peu terreux.
    paintBand({ width: 0.42, offset: 0.52 }, palette.woodShade);
    paintBand({ width: 0.3, offset: -0.5 }, palette.woodLight);
    if (boneOnScreen > 5) paintBand({ width: 0.1, offset: -0.66 }, palette.woodSheen);
  }

  // Passe 3 : l'écorce du fût. Seulement quand elle est assez large à l'écran
  // pour se lire — en dessous, ce ne serait qu'un bruit gris sur la silhouette.
  const trunkOnScreen = params.trunk.width * Math.min(boost, 1.25) * scale;
  if (params.detailed && trunkOnScreen > 110 && !hasSelection) {
    ctx.beginPath();
    traceBark(
      ctx,
      'ecorce',
      params.trunk.x,
      params.trunk.topY,
      params.trunk.baseY - ROW_HEIGHT * 0.5,
      params.trunk.width * Math.min(boost, 4.5),
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

  // Passe 6 : le feuillage, posé sur la ramure.
  if (params.nodes.length) drawFoliage(ctx, params, scale);

  // Passe 7 : la lignée sélectionnée, par-dessus, avec un halo.
  if (accent.length) {
    ctx.save();
    ctx.beginPath();
    for (const union of accent) traceUnion(ctx, union, weights, segments, boost);
    ctx.shadowColor = palette.highlight;
    ctx.shadowBlur = 26 / Math.max(scale, 0.25);
    ctx.fillStyle = palette.highlight;
    ctx.fill();
    ctx.restore();
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
