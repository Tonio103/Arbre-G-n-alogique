import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationRow, NodePosition } from '@/domain/layout';
import type { ViewportController } from '@/view/viewport';
import { toWorld } from '@/view/viewport';
import { CARD_HEIGHT, CARD_WIDTH, ROW_HEIGHT } from '@/view/metrics';

export interface GenerationRailProps {
  rows: GenerationRow[];
  positions: Map<string, NodePosition>;
  viewport: ViewportController;
}

/**
 * Repère vertical des générations.
 * Indique celle qu'on regarde et permet de sauter d'une époque à l'autre
 * sans traverser tout l'arbre à la main.
 */
export function GenerationRail({ rows, positions, viewport }: GenerationRailProps) {
  const [current, setCurrent] = useState(0);
  const frameRef = useRef(0);

  // Les générations anciennes ne comptent que quelques personnes réparties sur
  // toute la largeur de l'arbre : se contenter de changer d'altitude
  // déposerait souvent l'utilisateur dans le vide.
  const byGeneration = useMemo(() => {
    const map = new Map<number, NodePosition[]>();
    for (const position of positions.values()) {
      const list = map.get(position.generation);
      if (list) list.push(position);
      else map.set(position.generation, [position]);
    }
    for (const list of map.values()) list.sort((a, b) => a.x - b.x);
    return map;
  }, [positions]);

  useEffect(() => {
    const update = (): void => {
      frameRef.current = 0;
      const center = toWorld(
        viewport.transform,
        viewport.size.width / 2,
        viewport.size.height / 2,
      );
      // L'axe étant retourné, on ne peut pas déduire la génération d'une
      // division : on retient la rangée dont l'altitude est la plus proche.
      let generation = rows[0]?.generation ?? 0;
      let best = Infinity;
      for (const row of rows) {
        const distance = Math.abs(row.y + ROW_HEIGHT / 2 - center.y);
        if (distance < best) {
          best = distance;
          generation = row.generation;
        }
      }
      setCurrent((previous) => (previous === generation ? previous : generation));
    };

    const schedule = (): void => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(update);
    };

    schedule();
    const unsubscribe = viewport.subscribe(schedule);
    return () => {
      unsubscribe();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [viewport, rows]);

  if (rows.length === 0) return null;

  return (
    <nav className="rail lg lg--thick lg--pill lg--bar-v" aria-label="Générations">
      <ul className="rail-list">
        {/* L'arbre pousse vers le haut : la génération la plus récente est en
            haut de l'écran, le rail doit suivre le même ordre. */}
        {[...rows].reverse().map((row) => {
          const active = row.generation === current;
          return (
            <li key={row.generation}>
              <button
                type="button"
                className="rail-item"
                data-active={active || undefined}
                aria-current={active ? 'true' : undefined}
                title={`Génération ${row.generation + 1}${row.label ? ` · années ${row.label}` : ''} · ${row.count} personnes`}
                onClick={() => {
                  const center = toWorld(
                    viewport.transform,
                    viewport.size.width / 2,
                    viewport.size.height / 2,
                  );
                  const candidates = byGeneration.get(row.generation) ?? [];
                  let target: NodePosition | undefined;
                  let best = Infinity;
                  for (const candidate of candidates) {
                    const distance = Math.abs(candidate.x + CARD_WIDTH / 2 - center.x);
                    if (distance < best) {
                      best = distance;
                      target = candidate;
                    }
                  }
                  viewport.focusPoint(
                    target ? target.x + CARD_WIDTH / 2 : center.x,
                    target ? target.y + CARD_HEIGHT / 2 : row.y + ROW_HEIGHT / 2,
                    viewport.transform.scale,
                    0,
                    680,
                  );
                }}
              >
                <span className="rail-dot" aria-hidden="true" />
                <span className="rail-label">
                  <span className="rail-generation">G{row.generation + 1}</span>
                  {row.label && <span className="rail-decade">{row.label}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
