import { useEffect, useRef } from 'react';
import type { TreeLayout } from '@/domain/layout';
import type { SpatialIndex } from '@/view/spatial';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import { drawLinks, type LinkPalette } from '@/view/links';

export interface LinkLayerProps {
  viewport: ViewportController;
  layout: TreeLayout;
  spatial: SpatialIndex;
  /** Unions accentuées par la sélection courante. */
  highlightUnions: Set<string>;
  hasSelection: boolean;
  /** Unions du chemin de parenté affiché, tracées en accent. */
  pathUnions?: Set<string>;
  /** Change quand le thème change : la palette est relue. */
  theme: string;
}

function readPalette(theme: string): LinkPalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    line: read('--link', 'rgba(122, 138, 168, 0.55)'),
    strong: read('--link-highlight', '#2f6fdb'),
    dim: read('--link-dim', 'rgba(122, 138, 168, 0.16)'),
    cross: read('--link-cross', 'rgba(194, 118, 28, 0.5)'),
    band: read('--row-band', 'rgba(118, 136, 170, 0.05)'),
    bandLabel: read('--row-label', 'rgba(118, 136, 170, 0.4)'),
    // Ciel : un fil de lumière, large et doux, comme les liaisons d'une
    // carte du ciel. Atlas : un trait encré, l'ombre à peine plus large que
    // le trait lui-même, comme l'encre qui bave un rien dans le papier.
    glow:
      theme === 'dark'
        ? { color: read('--star-glow', 'rgba(255,255,255,0.9)'), blur: 5 }
        : { color: read('--star-glow', 'rgba(154,91,35,0.5)'), blur: 1.1 },
  };
}

/**
 * Les traits de filiation, sur un canevas unique.
 *
 * Un élément de page par lien coûterait des milliers de nœuds pour un dessin
 * qui n'est fait que de segments. Le coût ne dépend ici que de ce qui est
 * réellement dans le cadre.
 */
export function LinkLayer({
  viewport,
  layout,
  spatial,
  highlightUnions,
  hasSelection,
  pathUnions,
  theme,
}: LinkLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const paletteRef = useRef<LinkPalette | null>(null);

  const stateRef = useRef({ highlightUnions, hasSelection, pathUnions });
  stateRef.current = { highlightUnions, hasSelection, pathUnions };

  useEffect(() => {
    paletteRef.current = readPalette(theme);
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return undefined;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const paint = (): void => {
      frameRef.current = 0;
      const transform = viewport.transform;
      const rect = visibleRect(transform, { width, height }, 260);
      drawLinks(context, {
        unions: spatial.visibleUnions(rect),
        rows: layout.rows,
        crossLinks: layout.crossLinks,
        transform,
        width,
        height,
        dpr,
        palette: paletteRef.current ?? readPalette(theme),
        highlighted: stateRef.current.highlightUnions,
        hasSelection: stateRef.current.hasSelection,
        pathUnions: stateRef.current.pathUnions,
      });
    };

    const schedule = (): void => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(paint);
    };

    const resize = (): void => {
      const box = parent.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      schedule();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    const unsubscribe = viewport.subscribe(schedule);

    return () => {
      observer.disconnect();
      unsubscribe();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [viewport, layout, spatial]);

  // Une sélection ou un changement de thème doit repeindre immédiatement.
  useEffect(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      viewport.set(viewport.transform);
    });
  }, [highlightUnions, hasSelection, pathUnions, theme, viewport]);

  return <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />;
}
