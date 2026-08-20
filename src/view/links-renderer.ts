import type { CrossLink, LayoutUnion, NodePosition } from '@/domain/layout';
import { CARD_HEIGHT, CARD_WIDTH, ROW_HEIGHT, cardBottom, cardCenterX, cardCenterY } from './metrics';
import type { Transform } from './viewport';

export interface LinkPalette {
  base: string;
  dim: string;
  highlight: string;
  cross: string;
  node: string;
}

export interface DrawParams {
  unions: LayoutUnion[];
  crossLinks: CrossLink[];
  transform: Transform;
  width: number;
  height: number;
  dpr: number;
  palette: LinkPalette;
  /** Unions à accentuer ; vide = aucune sélection active. */
  highlighted: Set<string>;
  /** Vrai quand une sélection est active : le reste s'efface. */
  hasSelection: boolean;
}

/** Hauteur du rail horizontal qui distribue les enfants d'une union. */
const busOffset = (parentY: number): number => cardBottom(parentY) + (ROW_HEIGHT - CARD_HEIGHT) * 0.42;

const CORNER = 13;

/** Trait vertical, coude arrondi, trait horizontal, coude arrondi, trait vertical. */
function elbow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  midY: number,
): void {
  ctx.moveTo(fromX, fromY);
  if (Math.abs(toX - fromX) < 0.6) {
    ctx.lineTo(toX, toY);
    return;
  }
  const radius = Math.min(CORNER, Math.abs(toX - fromX) / 2, Math.abs(midY - fromY), Math.abs(toY - midY));
  const direction = toX > fromX ? 1 : -1;
  ctx.lineTo(fromX, midY - radius);
  ctx.quadraticCurveTo(fromX, midY, fromX + radius * direction, midY);
  ctx.lineTo(toX - radius * direction, midY);
  ctx.quadraticCurveTo(toX, midY, toX, midY + radius);
  ctx.lineTo(toX, toY);
}

function tracePath(ctx: CanvasRenderingContext2D, union: LayoutUnion, drawCouple: boolean): void {
  const { partners, children } = union;

  if (drawCouple && partners.length > 1 && union.adjacent) {
    const left = partners[0];
    const right = partners[partners.length - 1];
    const y = cardCenterY(left.y);
    ctx.moveTo(left.x + CARD_WIDTH, y);
    ctx.lineTo(right.x, y);
  }

  if (children.length === 0) return;

  const parentY = Math.max(...partners.map((p) => p.y));
  const midY = busOffset(parentY);
  const startY =
    partners.length > 1 && union.adjacent ? cardCenterY(parentY) : cardBottom(partners[0].y);

  // Tronc commun : du couple jusqu'au rail des enfants.
  ctx.moveTo(union.anchorX, startY);
  ctx.lineTo(union.anchorX, midY);

  for (const child of children) {
    elbow(ctx, union.anchorX, midY, cardCenterX(child.x), child.y, midY);
  }
}

function traceCross(ctx: CanvasRenderingContext2D, link: CrossLink): void {
  const ax = cardCenterX(link.a.x);
  const ay = cardCenterY(link.a.y);
  const bx = cardCenterX(link.b.x);
  const by = cardCenterY(link.b.y);
  const dip = Math.min(150, Math.abs(bx - ax) * 0.22 + 40);
  ctx.moveTo(ax, ay);
  ctx.bezierCurveTo(ax + (bx - ax) * 0.25, ay + dip, ax + (bx - ax) * 0.75, by + dip, bx, by);
}

export interface DotParams {
  nodes: NodePosition[];
  highlighted: Set<string>;
  hasSelection: boolean;
  color: string;
  accent: string;
  scale: number;
}

/**
 * Très loin, les cartes ne sont plus lisibles et coûtent cher à monter.
 * On les remplace par des points : l'arbre garde sa silhouette et le survol
 * d'ensemble reste possible, pour un coût constant.
 */
export function drawNodeDots(ctx: CanvasRenderingContext2D, params: DotParams): void {
  const radius = Math.max(2.6, 5 / Math.max(params.scale, 0.05));

  ctx.beginPath();
  for (const node of params.nodes) {
    if (params.highlighted.has(node.id)) continue;
    const x = node.x + CARD_WIDTH / 2;
    const y = node.y + CARD_HEIGHT / 2;
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  }
  ctx.fillStyle = params.color;
  ctx.globalAlpha = params.hasSelection ? 0.3 : 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  if (params.highlighted.size === 0) return;

  ctx.beginPath();
  for (const node of params.nodes) {
    if (!params.highlighted.has(node.id)) continue;
    const x = node.x + CARD_WIDTH / 2;
    const y = node.y + CARD_HEIGHT / 2;
    ctx.moveTo(x + radius * 1.5, y);
    ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
  }
  ctx.fillStyle = params.accent;
  ctx.fill();
}

export function drawLinks(ctx: CanvasRenderingContext2D, params: DrawParams): void {
  const { transform, width, height, dpr, palette, highlighted, hasSelection } = params;

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

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const scale = transform.scale;
  // L'épaisseur est compensée pour rester lisible quel que soit le zoom, sans
  // devenir un pâté quand on s'éloigne beaucoup.
  const baseWidth = Math.min(2.4, Math.max(0.9, 1.5 / Math.max(scale, 0.35)));
  const showCouples = scale > 0.12;

  const normal: LayoutUnion[] = [];
  const accent: LayoutUnion[] = [];
  for (const union of params.unions) {
    if (highlighted.has(union.id)) accent.push(union);
    else normal.push(union);
  }

  // Passe 1 : tout le reste de l'arbre, en un seul tracé.
  if (normal.length) {
    ctx.beginPath();
    for (const union of normal) tracePath(ctx, union, showCouples);
    ctx.strokeStyle = hasSelection ? palette.dim : palette.base;
    ctx.lineWidth = baseWidth;
    ctx.stroke();
  }

  // Passe 2 : liens croisés (mariages entre branches éloignées).
  if (params.crossLinks.length && scale > 0.14) {
    ctx.save();
    ctx.setLineDash([6 / Math.max(scale, 0.3), 7 / Math.max(scale, 0.3)]);
    ctx.beginPath();
    for (const link of params.crossLinks) traceCross(ctx, link);
    ctx.strokeStyle = hasSelection ? palette.dim : palette.cross;
    ctx.lineWidth = baseWidth * 0.9;
    ctx.stroke();
    ctx.restore();
  }

  // Passe 3 : la branche sélectionnée, par-dessus, avec un léger halo.
  if (accent.length) {
    ctx.save();
    ctx.beginPath();
    for (const union of accent) tracePath(ctx, union, showCouples);
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = baseWidth * 2.6;
    ctx.globalAlpha = 0.22;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = baseWidth * 1.45;
    ctx.stroke();
    ctx.restore();
  }

  // Marqueurs d'union : discrets, et seulement quand ils sont visibles.
  if (scale > 0.42) {
    const radius = 3.1 / Math.max(scale, 0.5);
    ctx.beginPath();
    for (const union of params.unions) {
      if (union.partners.length < 2 || !union.adjacent) continue;
      ctx.moveTo(union.anchorX + radius, union.anchorY);
      ctx.arc(union.anchorX, union.anchorY, radius, 0, Math.PI * 2);
    }
    ctx.fillStyle = hasSelection ? palette.dim : palette.node;
    ctx.fill();

    if (accent.length) {
      ctx.beginPath();
      for (const union of accent) {
        if (union.partners.length < 2 || !union.adjacent) continue;
        ctx.moveTo(union.anchorX + radius, union.anchorY);
        ctx.arc(union.anchorX, union.anchorY, radius, 0, Math.PI * 2);
      }
      ctx.fillStyle = palette.highlight;
      ctx.fill();
    }
  }
}
