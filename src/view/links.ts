import type { CrossLink, GenerationRow, LayoutUnion } from '@/domain/layout';
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  ROW_HEIGHT,
  cardCenterX,
  cardTop,
  cardBottom,
  portraitCenterY,
} from './metrics';

/*
 * ============================================================================
 *
 *  LES TRAITS DE FILIATION
 *
 *  Un arbre généalogique se lit, il ne se contemple pas. Les liens sont donc
 *  ce qu'ils sont sur tous les arbres imprimés depuis toujours : des traits
 *  orthogonaux. Un trait vertical descend du couple, un trait horizontal
 *  distribue, un trait vertical rejoint chaque enfant.
 *
 *  Ce choix n'est pas un renoncement, c'est ce qui rend le dessin infaillible.
 *  Une courbe doit décider par où passer et peut mal passer ; trois segments à
 *  angle droit partagent leurs extrémités par construction. Il ne peut pas
 *  exister de branche qui « ne touche pas » : le trait qui descend du bus et
 *  le bus lui-même sont le même point.
 *
 * ==========================================================================*/

export interface LinkPalette {
  /** Trait ordinaire. */
  line: string;
  /** Trait d'une lignée mise en évidence. */
  strong: string;
  /** Trait estompé, quand une autre lignée est sélectionnée. */
  dim: string;
  /** Alliance entre deux branches éloignées. */
  cross: string;
  /** Bande de fond, une rangée sur deux. */
  band: string;
  /** Étiquette de décennie, dans la marge de chaque bande. */
  bandLabel: string;
  /**
   * La touche du thème, portée jusque sur le trait.
   *
   * Ciel : un fil de lumière plutôt qu'un vecteur froid — une lueur portée
   * sous le trait, comme les liaisons d'une carte du ciel. Atlas : un trait
   * encré plutôt qu'une ligne de logiciel — une ombre très courte et sombre,
   * comme l'encre qui bave à peine dans le papier.
   */
  glow: { color: string; blur: number };
}

export interface DrawLinksParams {
  unions: LayoutUnion[];
  /** Rangées de générations, pour les bandes de fond. */
  rows: GenerationRow[];
  crossLinks: CrossLink[];
  /**
   * La zone du monde couverte par ce canevas — pas le cadre visible à
   * l'instant du dessin, mais l'étendue, plus large, pré-rendue une fois pour
   * plusieurs images (voir `LinkLayer`).
   */
  worldRect: { left: number; top: number; right: number; bottom: number };
  /**
   * Pixels de canevas par unité du monde, à l'instant du dessin — pas
   * l'échelle courante de la vue. Le canevas vit dans `.world` et hérite de
   * son `transform: scale()` : il n'a donc besoin d'être redessiné à cette
   * densité que de loin en loin, pas à chaque image de zoom.
   */
  density: number;
  dpr: number;
  palette: LinkPalette;
  /** Unions accentuées par la sélection courante. */
  highlighted: Set<string>;
  hasSelection: boolean;
  /** Unions du chemin de parenté affiché, tracées en accent par-dessus tout. */
  pathUnions?: Set<string>;
}

/**
 * Hauteur du trait distributeur au-dessus de la rangée des enfants.
 *
 * À mi-chemin entre les deux rangées : c'est là qu'il sépare le plus
 * nettement ce qui descend de ce qui distribue.
 */
const BUS_LIFT = (ROW_HEIGHT - CARD_HEIGHT) * 0.5;

/** Rayon des coudes. Assez petit pour rester net, assez grand pour se voir. */
const CORNER = 9;

/**
 * Trace un coude arrondi entre trois points alignés en équerre.
 *
 * `arcTo` fait exactement cela et gère seul le cas dégénéré — deux points
 * confondus, ou un angle nul — sans qu'on ait à le détecter.
 */
function elbow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  cornerX: number,
  cornerY: number,
  toX: number,
  toY: number,
): void {
  ctx.moveTo(fromX, fromY);
  ctx.arcTo(cornerX, cornerY, toX, toY, CORNER);
  ctx.lineTo(toX, toY);
}

export function drawLinks(ctx: CanvasRenderingContext2D, params: DrawLinksParams): void {
  const { worldRect, dpr, palette, highlighted, hasSelection } = params;
  const density = Math.max(params.density, 0.02);

  const bufferWidth = (worldRect.right - worldRect.left) * density * dpr;
  const bufferHeight = (worldRect.bottom - worldRect.top) * density * dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bufferWidth, bufferHeight);
  // Le canevas ne couvre pas l'origine du monde : son coin (worldRect.left,
  // worldRect.top) doit tomber sur le pixel (0, 0) de son propre tampon.
  ctx.setTransform(
    density * dpr,
    0,
    0,
    density * dpr,
    -worldRect.left * density * dpr,
    -worldRect.top * density * dpr,
  );

  /*
   * Les bandes de génération.
   *
   * Une rangée sur deux, à peine teintée. Sur cinq cents personnes réparties
   * sur treize mille unités de large, rien ne dit à quelle génération on est
   * en train de regarder : l'œil perd sa ligne dès qu'il se déplace
   * latéralement. La bande la lui rend, et la décennie posée dans sa marge
   * donne l'époque sans qu'on ait à consulter quoi que ce soit.
   *
   * L'étiquette est calée sur le bord de la zone couverte par ce canevas, pas
   * sur le cadre visible à l'instant précis : ce dernier change à chaque
   * image, la zone couverte seulement de loin en loin (voir `LinkLayer`).
   * En pratique elle suit un déplacement continu par à-coups plutôt qu'en
   * temps réel — un compromis largement rentable au vu de ce qu'il économise.
   */
  const left = worldRect.left;
  const right = worldRect.right;
  const bandTop = worldRect.top;
  const bandBottom = worldRect.bottom;

  for (const row of params.rows) {
    if (row.generation % 2 !== 0) continue;
    const top = row.y - (ROW_HEIGHT - CARD_HEIGHT) / 2;
    if (top > bandBottom || top + ROW_HEIGHT < bandTop) continue;
    ctx.fillStyle = palette.band;
    ctx.fillRect(left, top, right - left, ROW_HEIGHT);
  }

  // La décennie, calée sur le bord gauche du cadre : elle reste lisible où
  // qu'on se trouve dans la largeur, sans jamais recouvrir une carte.
  const labelSize = 13 / density;
  if (labelSize < ROW_HEIGHT * 0.5) {
    ctx.fillStyle = palette.bandLabel;
    ctx.font = `600 ${labelSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const row of params.rows) {
      if (!row.label) continue;
      const middle = row.y + CARD_HEIGHT / 2;
      if (middle < bandTop || middle > bandBottom) continue;
      ctx.fillText(row.label, left + 16 / density, middle);
    }
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Trois passes, une par teinte : changer de couleur rompt le chemin, et un
  // millier de chemins d'un seul segment coûte bien plus que trois chemins
  // d'un millier de segments.
  const groups: Array<{ list: LayoutUnion[]; color: string; weight: number }> = hasSelection
    ? [
        {
          list: params.unions.filter((union) => !highlighted.has(union.id)),
          color: palette.dim,
          weight: 1.4,
        },
        {
          list: params.unions.filter((union) => highlighted.has(union.id)),
          color: palette.strong,
          weight: 2.6,
        },
      ]
    : [{ list: params.unions, color: palette.line, weight: 1.7 }];

  // L'ombre du trait suit l'échelle comme son épaisseur, sinon la lueur du
  // ciel ou le bavure de l'encre grossirait avec le zoom au lieu de rester
  // une propriété du trait lui-même.
  ctx.shadowColor = palette.glow.color;
  ctx.shadowBlur = palette.glow.blur / density;

  for (const group of groups) {
    if (group.list.length === 0) continue;
    ctx.beginPath();
    for (const union of group.list) traceUnion(ctx, union);
    ctx.strokeStyle = group.color;
    // L'épaisseur est donnée en pixels d'écran : un trait de liaison ne
    // grossit pas avec le zoom, sans quoi il finit par masquer les cartes.
    ctx.lineWidth = group.weight / density;
    ctx.stroke();
  }

  // Le chemin de parenté, par-dessus tout le reste : c'est la réponse à la
  // question qu'on vient de poser, elle ne doit se perdre dans rien.
  if (params.pathUnions && params.pathUnions.size > 0) {
    const onPath = params.unions.filter((union) => params.pathUnions!.has(union.id));
    if (onPath.length > 0) {
      ctx.beginPath();
      for (const union of onPath) traceUnion(ctx, union);
      ctx.strokeStyle = palette.strong;
      ctx.lineWidth = 3.2 / density;
      ctx.stroke();
    }
  }

  ctx.shadowBlur = 0;

  /*
   * Le jalon de chaque union.
   *
   * Un trait qui bifurque a besoin d'un point où bifurquer — sans lui, le
   * réseau de traits reste un pur vecteur, sans rien qui dise « c'est ici
   * qu'une famille commence ». Ciel : une étoile de plus, dans la même
   * couleur que le fil de lumière des traits. Atlas : un point d'encre, là
   * où la plume a posé le paraphe du mariage.
   */
  const hubRadius = 2 / density;
  ctx.beginPath();
  for (const union of params.unions) {
    const hub = unionHub(union);
    if (!hub) continue;
    ctx.moveTo(hub.x + hubRadius, hub.y);
    ctx.arc(hub.x, hub.y, hubRadius, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.glow.color;
  ctx.globalAlpha = hasSelection ? 0.32 : 0.85;
  ctx.fill();

  if (hasSelection && highlighted.size > 0) {
    const hubRadiusStrong = 2.6 / density;
    ctx.beginPath();
    for (const union of params.unions) {
      if (!highlighted.has(union.id)) continue;
      const hub = unionHub(union);
      if (!hub) continue;
      ctx.moveTo(hub.x + hubRadiusStrong, hub.y);
      ctx.arc(hub.x, hub.y, hubRadiusStrong, 0, Math.PI * 2);
    }
    ctx.fillStyle = palette.strong;
    ctx.globalAlpha = 1;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Alliances entre branches éloignées : en pointillé, pour qu'on ne les
  // confonde jamais avec une filiation.
  if (params.crossLinks.length > 0) {
    ctx.beginPath();
    for (const link of params.crossLinks) {
      const ay = portraitCenterY(link.a.y);
      const by = portraitCenterY(link.b.y);
      ctx.moveTo(cardCenterX(link.a.x), ay);
      ctx.lineTo(cardCenterX(link.b.x), by);
    }
    ctx.setLineDash([6 / density, 6 / density]);
    ctx.strokeStyle = hasSelection ? palette.dim : palette.cross;
    ctx.lineWidth = 1.3 / density;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Le point où une union « se noue » : le milieu du trait d'alliance pour un
 *  couple, le bas de la carte pour un parent seul. */
function unionHub(union: LayoutUnion): { x: number; y: number } | undefined {
  const { partners } = union;
  if (partners.length === 0) return undefined;
  const sorted = [...partners].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length > 1 && union.adjacent) {
    const y = portraitCenterY(Math.min(first.y, last.y));
    return { x: (cardCenterX(first.x) + cardCenterX(last.x)) / 2, y };
  }
  return { x: cardCenterX(first.x), y: cardBottom(first.y) };
}

function traceUnion(ctx: CanvasRenderingContext2D, union: LayoutUnion): void {
  const { partners, children } = union;
  if (partners.length === 0) return;

  const sorted = [...partners].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // Le trait d'alliance, entre les deux portraits.
  if (sorted.length > 1 && union.adjacent) {
    const y = portraitCenterY(Math.min(first.y, last.y));
    ctx.moveTo(cardCenterX(first.x), y);
    ctx.lineTo(cardCenterX(last.x), y);
  }

  if (children.length === 0) return;

  // Le départ : du milieu du trait d'alliance pour un couple, du bas de la
  // carte pour un parent seul.
  const startX = union.anchorX;
  const startY =
    sorted.length > 1 && union.adjacent
      ? portraitCenterY(Math.min(first.y, last.y))
      : cardBottom(first.y);

  let childTop = Number.POSITIVE_INFINITY;
  let leftMost = Number.POSITIVE_INFINITY;
  let rightMost = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    childTop = Math.min(childTop, cardTop(child.y));
    const centre = cardCenterX(child.x);
    leftMost = Math.min(leftMost, centre);
    rightMost = Math.max(rightMost, centre);
  }

  const busY = childTop - BUS_LIFT;

  // Enfant unique à l'aplomb du couple : un simple trait droit. Le bus n'aurait
  // rien à distribuer, et son coude se lirait comme un détour.
  if (children.length === 1 && Math.abs(leftMost - startX) < 1) {
    ctx.moveTo(startX, startY);
    ctx.lineTo(leftMost, childTop);
    return;
  }

  // La descente depuis le couple.
  ctx.moveTo(startX, startY);
  ctx.lineTo(startX, busY);

  // Le distributeur. Il couvre les enfants et rejoint l'aplomb du couple, même
  // quand celui-ci tombe hors de la fratrie — cas d'un enfant unique décalé.
  const busLeft = Math.min(leftMost, startX);
  const busRight = Math.max(rightMost, startX);
  if (busRight - busLeft > 0.5) {
    ctx.moveTo(busLeft, busY);
    ctx.lineTo(busRight, busY);
  }

  // Une descente par enfant, avec un coude arrondi à la sortie du bus.
  for (const child of children) {
    const centre = cardCenterX(child.x);
    const top = cardTop(child.y);
    if (top - busY <= CORNER * 2) {
      ctx.moveTo(centre, busY);
      ctx.lineTo(centre, top);
      continue;
    }
    elbow(ctx, centre, busY, centre, top, centre, top);
  }
}

/** Étendue d'une union, pour ne dessiner que ce qui est réellement visible. */
export function unionExtent(union: LayoutUnion): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of [...union.partners, ...union.children]) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x + CARD_WIDTH);
    bottom = Math.max(bottom, point.y + CARD_HEIGHT);
  }
  return { left, top, right, bottom };
}
