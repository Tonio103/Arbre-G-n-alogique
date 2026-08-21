import { useEffect, useRef } from 'react';
import type { TreeLayout } from '@/domain/layout';
import type { SpatialIndex } from '@/view/spatial';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import type { HoverStore } from '@/view/hover-store';
import { drawCanopy, drawTree, type TreePalette } from '@/view/tree-renderer';
import { LOD_COMPACT } from '@/view/metrics';

export interface BranchLayerProps {
  viewport: ViewportController;
  layout: TreeLayout;
  spatial: SpatialIndex;
  hoverStore: HoverStore;
  /** Unions accentuées par la sélection courante. */
  highlightUnions: Set<string>;
  /** Personnes accentuées, utilisées pour le feuillage en vue lointaine. */
  highlightPeople: Set<string>;
  hasSelection: boolean;
  /** Change quand le thème change : la palette est relue. */
  theme: string;
}

function readPalette(): TreePalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    ground: read('--ground', 'rgba(126, 142, 112, 0.16)'),
    groundShade: read('--ground-shade', 'rgba(60, 66, 52, 0.16)'),
    trunk: read('--wood-trunk', 'rgba(94,72,52,0.85)'),
    twig: read('--wood-twig', 'rgba(150,124,92,0.7)'),
    bark: read('--wood-bark', 'rgba(62,46,32,0.22)'),
    woodLight: read('--wood-light', 'rgba(255,236,206,0.3)'),
    woodShade: read('--wood-shade', 'rgba(46,32,20,0.22)'),
    woodSheen: read('--wood-sheen', 'rgba(255,246,226,0.4)'),
    dim: read('--wood-dim', 'rgba(120,100,80,0.12)'),
    highlight: read('--link-highlight', '#2f6fdb'),
    cross: read('--link-cross', 'rgba(194,118,28,0.55)'),
    marriage: read('--link-marriage', 'rgba(150,110,64,0.9)'),
    leaf: read('--leaf', '#7ba86f'),
    leafAlt: read('--leaf-alt', '#5f8f5c'),
    leafLit: read('--leaf-lit', '#a8d18c'),
    node: read('--wood-twig', 'rgba(150,124,92,0.7)'),
  };
}

/**
 * La ramure entière, dessinée sur un seul canvas.
 *
 * Chaque branche est un polygone fuselé dont l'épaisseur dépend du nombre de
 * personnes qu'elle porte : un élément de DOM par lien coûterait des milliers
 * de nœuds et interdirait ce dégradé d'épaisseur. Le coût ne dépend que de ce
 * qui est réellement dans le cadre, et le survol se repeint sans passer par
 * React.
 */
export function BranchLayer({
  viewport,
  layout,
  spatial,
  hoverStore,
  highlightUnions,
  highlightPeople,
  hasSelection,
  theme,
}: BranchLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const paletteRef = useRef<TreePalette | null>(null);

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
    // Le détail ne se dessine qu'au repos ; un dernier rendu le rétablit dès
    // que la vue s'immobilise.
    let moving = false;
    let settleTimer = 0;

    const paint = (): void => {
      frameRef.current = 0;
      const palette = paletteRef.current ?? readPalette();
      const transform = viewport.transform;
      const rect = visibleRect(transform, { width, height }, 320);

      const visibleNodes = spatial.visibleNodes(rect);
      const hovered = hoverStore.getSnapshot();
      const accentUnions = new Set(highlightUnionsRef.current);
      if (hovered) {
        for (const unionId of layout.unionsByPerson.get(hovered) ?? []) accentUnions.add(unionId);
      }

      drawTree(context, {
        unions: spatial.visibleUnions(rect),
        crossLinks: layout.crossLinks,
        weights: layout.weights,
        bounds: layout.bounds,
        transform,
        width,
        height,
        dpr,
        palette,
        highlighted: accentUnions,
        hasSelection: hasSelectionRef.current,
        trunk: layout.trunk,
        nodes: visibleNodes,
        detailed: !moving,
      });

      if (transform.scale < LOD_COMPACT) {
        const accentPeople = new Set(highlightPeopleRef.current);
        if (hovered) accentPeople.add(hovered);
        drawCanopy(context, {
          nodes: visibleNodes,
          weights: layout.weights,
          highlighted: accentPeople,
          hasSelection: hasSelectionRef.current,
          palette,
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

    const onViewportChange = (): void => {
      moving = true;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        moving = false;
        schedule();
      }, 170);
      schedule();
    };

    const unsubscribeViewport = viewport.subscribe(onViewportChange);
    const unsubscribeHover = hoverStore.subscribe(schedule);

    return () => {
      observer.disconnect();
      unsubscribeViewport();
      unsubscribeHover();
      window.clearTimeout(settleTimer);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [viewport, layout, spatial, hoverStore]);

  // Une sélection ou un changement de thème doit repeindre immédiatement.
  useEffect(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      viewport.set(viewport.transform);
    });
  }, [highlightUnions, highlightPeople, hasSelection, theme, viewport]);

  return <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />;
}
