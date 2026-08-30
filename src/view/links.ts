import type { GenerationRow, LayoutUnion } from '@/domain/layout';
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
  /**
   * L'union qu'on vient de créer (nouveau proche ajouté), et l'avancement de
   * son tracé — 0 au tout début, 1 une fois complet. Tant que `progress < 1`,
   * cette union est retirée du tracé normal : sans quoi le trait complet
   * transparaîtrait déjà sous l'animation, qui ne ferait plus que le
   * souligner au lieu de le révéler.
   */
  growth?: { unionId: string; progress: number };
}

/**
 * Hauteur du trait distributeur au-dessus de la rangée des enfants.
 *
 * À mi-chemin entre les deux rangées : c'est là qu'il sépare le plus
 * nettement ce qui descend de ce qui distribue.
 */
const BUS_LIFT = (ROW_HEIGHT - CARD_HEIGHT) * 0.5;

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

  // L'union en cours d'apparition est retirée du tracé normal tant qu'elle
  // n'est pas complète : sinon le trait entier transparaîtrait déjà dessous,
  // et l'animation ne ferait que le souligner au lieu de le révéler.
  const growingId = params.growth && params.growth.progress < 1 ? params.growth.unionId : undefined;
  const drawableUnions = growingId
    ? params.unions.filter((union) => union.id !== growingId)
    : params.unions;

  // Trois passes, une par teinte : changer de couleur rompt le chemin, et un
  // millier de chemins d'un seul segment coûte bien plus que trois chemins
  // d'un millier de segments.
  const groups: Array<{ list: LayoutUnion[]; color: string; weight: number }> = hasSelection
    ? [
        {
          list: drawableUnions.filter((union) => !highlighted.has(union.id)),
          color: palette.dim,
          weight: 1.4,
        },
        {
          list: drawableUnions.filter((union) => highlighted.has(union.id)),
          color: palette.strong,
          weight: 2.6,
        },
      ]
    : [{ list: drawableUnions, color: palette.line, weight: 1.7 }];

  // L'ombre du trait suit l'échelle comme son épaisseur, sinon la lueur du
  // ciel ou le bavure de l'encre grossirait avec le zoom au lieu de rester
  // une propriété du trait lui-même.
  ctx.shadowColor = palette.glow.color;
  ctx.shadowBlur = palette.glow.blur / density;

  for (const group of groups) {
    if (group.list.length === 0) continue;
    ctx.beginPath();
    // Un divorce garde son trait de descente plein — se séparer ne défait
    // pas la filiation — mais pas son trait d'alliance : celui-là se
    // dessine à part, plus bas, en pointillé.
    for (const union of group.list) traceUnion(ctx, union, union.status !== 'divorced');
    ctx.strokeStyle = group.color;
    // L'épaisseur est donnée en pixels d'écran : un trait de liaison ne
    // grossit pas avec le zoom, sans quoi il finit par masquer les cartes.
    ctx.lineWidth = group.weight / density;
    ctx.stroke();
  }

  /*
   * Le trait d'alliance d'un divorce, à part et en pointillé.
   *
   * Un couple séparé garde sa place dans l'arbre — ses enfants en
   * descendent toujours — mais le trait qui les unissait, lui, ne doit plus
   * se lire comme un lien intact. Chaque teinte (atténuée, accentuée ou
   * normale) reprend le même partage que les traits pleins ci-dessus, pour
   * qu'un divorce mis en évidence par la sélection le reste ici aussi.
   */
  const divorced = drawableUnions.filter((union) => union.status === 'divorced');
  if (divorced.length > 0) {
    for (const group of groups) {
      const list = group.list.filter((union) => union.status === 'divorced');
      if (list.length === 0) continue;
      ctx.beginPath();
      for (const union of list) {
        const alliance = allianceSegment(union);
        if (!alliance) continue;
        const [x1, y1, x2, y2] = alliance;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.setLineDash([5 / density, 4 / density]);
      ctx.strokeStyle = group.color;
      ctx.lineWidth = group.weight / density;
      ctx.stroke();
    }
    ctx.setLineDash([]);
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

  // L'union tout juste créée se dessine elle-même, trait par trait, dans le
  // même ordre de lecture que le reste de l'arbre (alliance, descente, bus,
  // puis chaque enfant) — la même technique de révélation par longueur de
  // trait que le rideau d'ouverture, portée ici sur le canevas via
  // `setLineDash`/`lineDashOffset` plutôt que `stroke-dashoffset` en SVG.
  if (params.growth) {
    const growing = params.unions.find((union) => union.id === params.growth!.unionId);
    const length = growing ? unionPathLength(growing) : 0;
    if (growing && length > 0) {
      const progress = Math.min(1, Math.max(0, params.growth.progress));
      ctx.beginPath();
      traceUnion(ctx, growing);
      ctx.setLineDash([length, length]);
      ctx.lineDashOffset = length * (1 - progress);
      ctx.strokeStyle = palette.strong;
      ctx.lineWidth = 3 / density;
      ctx.shadowColor = palette.glow.color;
      ctx.shadowBlur = (palette.glow.blur + 5) / density;
      ctx.stroke();
      ctx.setLineDash([]);
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

  /*
   * Le veuvage : le même « † » que porte déjà la fiche de la personne
   * disparue (voir `.node[data-deceased] .node-years::before` dans
   * `node.css`) — pas un symbole inventé pour l'occasion, le même repère
   * qu'on a déjà appris à lire, posé cette fois sur le nœud de l'union
   * plutôt que caché dans une fiche qu'il faudrait ouvrir pour le découvrir.
   */
  const widowed = params.unions.filter((union) => union.status === 'widowed');
  if (widowed.length > 0) {
    const fontSize = 11 / density;
    ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = palette.bandLabel;
    ctx.globalAlpha = hasSelection ? 0.55 : 0.85;
    for (const union of widowed) {
      const hub = unionHub(union);
      if (!hub) continue;
      ctx.fillText('†', hub.x, hub.y - 6 / density);
    }
    ctx.globalAlpha = 1;
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

/** Un segment orthogonal, dans l'ordre où l'union se lit : `[x1, y1, x2, y2]`. */
type Segment = readonly [number, number, number, number];

/**
 * Les segments d'une union, source commune au tracé normal (`traceUnion`) et
 * au calcul de longueur pour son animation d'apparition (`unionPathLength`) :
 * une seule géométrie, jamais deux versions qui pourraient diverger.
 *
 * Dans l'ordre de lecture : le trait d'alliance entre les deux portraits, la
 * descente depuis le couple, le distributeur, puis une descente par enfant.
 */
/**
 * Le trait d'alliance entre les deux conjoints — rien d'autre.
 *
 * Séparé de `unionSegments` pour qu'un divorce puisse le dessiner à part, en
 * pointillé, sans toucher au tracé (plein, continu) de la descente vers les
 * enfants : se séparer ne défait pas la filiation.
 */
function allianceSegment(union: LayoutUnion): Segment | undefined {
  const { partners } = union;
  if (partners.length < 2 || !union.adjacent) return undefined;
  const sorted = [...partners].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const y = portraitCenterY(Math.min(first.y, last.y));
  return [cardCenterX(first.x), y, cardCenterX(last.x), y];
}

function unionSegments(union: LayoutUnion, includeAlliance = true): Segment[] {
  const { partners, children } = union;
  if (partners.length === 0) return [];

  const segments: Segment[] = [];
  const sorted = [...partners].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (includeAlliance) {
    const alliance = allianceSegment(union);
    if (alliance) segments.push(alliance);
  }

  if (children.length === 0) return segments;

  // Le départ : du milieu du trait d'alliance pour un couple voisin, du bas
  // de la carte sinon — un parent seul, ou un mariage entre deux branches
  // dont les enfants sont rattachés au sous-arbre d'un seul des deux (voir
  // `anchorX` dans `domain/layout.ts` pour le pourquoi).
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

  /*
   * Un seul étage de trait suffit.
   *
   * Les familles étaient autrefois réparties sur plusieurs hauteurs, pour que
   * deux traits distributeurs qui se recouvrent ne se confondent pas en une
   * seule ligne. Dans une ascendance, ce recouvrement ne peut plus se produire :
   * chaque couple a sa propre part de la rangée. Mesuré sur la famille
   * Albertini, un seul étage était utilisé sur les vingt-trois unions.
   */
  const busY = childTop - BUS_LIFT;

  // Enfant unique à l'aplomb du couple : un simple trait droit. Le bus n'aurait
  // rien à distribuer, et son coude se lirait comme un détour.
  if (children.length === 1 && Math.abs(leftMost - startX) < 1) {
    segments.push([startX, startY, leftMost, childTop]);
    return segments;
  }

  // La descente depuis le couple.
  segments.push([startX, startY, startX, busY]);

  // Le distributeur. Il couvre les enfants et rejoint l'aplomb du couple, même
  // quand celui-ci tombe hors de la fratrie — cas d'un enfant unique décalé.
  const busLeft = Math.min(leftMost, startX);
  const busRight = Math.max(rightMost, startX);
  if (busRight - busLeft > 0.5) {
    segments.push([busLeft, busY, busRight, busY]);
  }

  // Une descente par enfant : un simple trait droit depuis le bus. Aucun
  // coude à arrondir ici — le bus et chaque descente sont deux traits
  // distincts qui se rejoignent au même point, pas un unique chemin continu
  // que `arcTo` pourrait infléchir.
  for (const child of children) {
    const centre = cardCenterX(child.x);
    const top = cardTop(child.y);
    segments.push([centre, busY, centre, top]);
  }

  return segments;
}

function traceUnion(ctx: CanvasRenderingContext2D, union: LayoutUnion, includeAlliance = true): void {
  for (const [x1, y1, x2, y2] of unionSegments(union, includeAlliance)) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
}

/** Longueur totale du trait d'une union — voir `growth` dans `DrawLinksParams`. */
function unionPathLength(union: LayoutUnion): number {
  let total = 0;
  for (const [x1, y1, x2, y2] of unionSegments(union)) {
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
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
