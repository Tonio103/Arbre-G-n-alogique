import type { LayoutUnion, NodePosition, TreeLayout } from '@/domain/layout';
import { CARD_HEIGHT, CARD_WIDTH } from './metrics';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const CELL_SIZE = 640;

interface Grid<T> {
  cells: Map<number, T[]>;
}

const cellKey = (cx: number, cy: number): number => cx * 73856093 + cy * 19349663;

function insert<T>(grid: Grid<T>, rect: Rect, item: T): void {
  const x0 = Math.floor(rect.left / CELL_SIZE);
  const x1 = Math.floor(rect.right / CELL_SIZE);
  const y0 = Math.floor(rect.top / CELL_SIZE);
  const y1 = Math.floor(rect.bottom / CELL_SIZE);
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      const key = cellKey(cx, cy);
      const bucket = grid.cells.get(key);
      if (bucket) bucket.push(item);
      else grid.cells.set(key, [item]);
    }
  }
}

function query<T>(grid: Grid<T>, rect: Rect, out: Set<T>): void {
  const x0 = Math.floor(rect.left / CELL_SIZE);
  const x1 = Math.floor(rect.right / CELL_SIZE);
  const y0 = Math.floor(rect.top / CELL_SIZE);
  const y1 = Math.floor(rect.bottom / CELL_SIZE);
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      const bucket = grid.cells.get(cellKey(cx, cy));
      if (!bucket) continue;
      for (const item of bucket) out.add(item);
    }
  }
}

/**
 * Index spatial du monde : permet de ne travailler que sur ce qui est
 * réellement dans le cadre, quel que soit le nombre total de personnes.
 */
export class SpatialIndex {
  private readonly nodeGrid: Grid<NodePosition> = { cells: new Map() };
  private readonly unionGrid: Grid<LayoutUnion> = { cells: new Map() };

  constructor(layout: TreeLayout) {
    for (const position of layout.positions.values()) {
      insert(
        this.nodeGrid,
        {
          left: position.x,
          top: position.y,
          right: position.x + CARD_WIDTH,
          bottom: position.y + CARD_HEIGHT,
        },
        position,
      );
    }
    for (const union of layout.unions) {
      insert(this.unionGrid, unionBounds(union), union);
    }
  }

  visibleNodes(rect: Rect): NodePosition[] {
    const found = new Set<NodePosition>();
    query(this.nodeGrid, rect, found);
    const result: NodePosition[] = [];
    for (const position of found) {
      if (
        position.x + CARD_WIDTH >= rect.left &&
        position.x <= rect.right &&
        position.y + CARD_HEIGHT >= rect.top &&
        position.y <= rect.bottom
      ) {
        result.push(position);
      }
    }
    return result;
  }

  visibleUnions(rect: Rect): LayoutUnion[] {
    const found = new Set<LayoutUnion>();
    query(this.unionGrid, rect, found);
    return [...found];
  }
}

export function unionBounds(union: LayoutUnion): Rect {
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
  if (!Number.isFinite(left)) {
    return { left: union.anchorX, top: union.anchorY, right: union.anchorX, bottom: union.anchorY };
  }
  return { left, top, right, bottom };
}
