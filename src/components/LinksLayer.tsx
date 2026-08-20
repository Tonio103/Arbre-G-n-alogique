import { useEffect, useRef } from 'react';
import type { TreeLayout } from '@/domain/layout';
import type { SpatialIndex } from '@/view/spatial';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import type { HoverStore } from '@/view/hover-store';
import { drawLinks, drawNodeDots, type LinkPalette } from '@/view/links-renderer';
import { LOD_COMPACT } from '@/view/metrics';

export interface LinksLayerProps {
  viewport: ViewportController;
  layout: TreeLayout;
  spatial: SpatialIndex;
  hoverStore: HoverStore;
  /** Unions accentuées par la sélection courante. */
  highlightUnions: Set<string>;
  /** Personnes accentuées, utilisées pour les points en vue éloignée. */
  highlightPeople: Set<string>;
  hasSelection: boolean;
  /** Change quand le thème change : la palette est relue. */
  theme: string;
}

function readPalette(): LinkPalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    base: read('--link-base', 'rgba(174,196,240,0.3)'),
    dim: read('--link-dim', 'rgba(150,172,214,0.09)'),
    highlight: read('--link-highlight', '#9dc2ff'),
    cross: read('--link-cross', 'rgba(255,201,138,0.42)'),
    node: read('--link-node', 'rgba(190,210,245,0.5)'),
  };
}

/**
 * Toutes les lignes de parenté, dessinées sur un seul canvas.
 *
 * Un élément SVG par lien coûterait des milliers de nœuds DOM et rendrait le
 * déplacement saccadé bien avant la centième personne. Ici le coût ne dépend
 * que de ce qui est visible, et le survol se repeint sans passer par React.
 */
export function LinksLayer({
  viewport,
  layout,
  spatial,
  hoverStore,
  highlightUnions,
  highlightPeople,
  hasSelection,
  theme,
}: LinksLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const paletteRef = useRef<LinkPalette | null>(null);

  // Les valeurs qui changent souvent passent par des refs : le rendu canvas les
  // lit au moment de peindre, sans qu'un nouveau rendu React soit nécessaire.
  const highlightUnionsRef = useRef(highlightUnions);
  const highlightPeopleRef = useRef(highlightPeople);
  const hasSelectionRef = useRef(hasSelection);
  highlightUnionsRef.current = highlightUnions;
  highlightPeopleRef.current = highlightPeople;
  hasSelectionRef.current = hasSelection;

  useEffect(() => {
    paletteRef.current = readPalette();
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
      const palette = paletteRef.current ?? readPalette();
      const transform = viewport.transform;
      const rect = visibleRect(transform, { width, height }, 260);

      const hovered = hoverStore.getSnapshot();
      const accentUnions = new Set(highlightUnionsRef.current);
      if (hovered) {
        for (const unionId of layout.unionsByPerson.get(hovered) ?? []) accentUnions.add(unionId);
      }

      const unions = spatial.visibleUnions(rect);
      const crossLinks = layout.crossLinks;

      drawLinks(context, {
        unions,
        crossLinks,
        transform,
        width,
        height,
        dpr,
        palette,
        highlighted: accentUnions,
        hasSelection: hasSelectionRef.current,
      });

      // En vue très éloignée, les cartes ne sont plus montées : on trace les
      // personnes en points pour conserver la silhouette de l'arbre.
      if (transform.scale < LOD_COMPACT) {
        const accentPeople = new Set(highlightPeopleRef.current);
        if (hovered) accentPeople.add(hovered);
        drawNodeDots(context, {
          nodes: spatial.visibleNodes(rect),
          highlighted: accentPeople,
          hasSelection: hasSelectionRef.current,
          color: palette.node,
          accent: palette.highlight,
          scale: transform.scale,
        });
      }
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

    const unsubscribeViewport = viewport.subscribe(schedule);
    const unsubscribeHover = hoverStore.subscribe(schedule);

    return () => {
      observer.disconnect();
      unsubscribeViewport();
      unsubscribeHover();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [viewport, layout, spatial, hoverStore]);

  // Une sélection ou un changement de thème doit repeindre immédiatement.
  useEffect(() => {
    if (frameRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      viewport.set(viewport.transform);
    });
  }, [highlightUnions, highlightPeople, hasSelection, theme, viewport]);

  return <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />;
}
