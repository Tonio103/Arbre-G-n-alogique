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
  /** Personne sélectionnée : le surlignage rayonne depuis elle. */
  focus: { x: number; y: number } | null;
  /** Change quand le thème change : la palette est relue. */
  theme: string;
}

function readPalette(): TreePalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    ground: read('--ground', 'rgba(126, 142, 112, 0.16)'),
    soil: read('--soil', 'rgba(146, 126, 96, 0.5)'),
    groundShade: read('--ground-shade', 'rgba(60, 66, 52, 0.16)'),
    stone: read('--stone', 'rgba(196, 194, 188, 0.85)'),
    stoneShade: read('--stone-shade', 'rgba(126, 124, 118, 0.8)'),
    grass: read('--grass', 'rgba(108, 152, 92, 0.85)'),
    grassAlt: read('--grass-alt', 'rgba(82, 122, 76, 0.7)'),
    bloom: read('--bloom', 'rgba(240, 196, 120, 0.95)'),
    bloomAlt: read('--bloom-alt', 'rgba(216, 152, 190, 0.9)'),
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
  focus,
  theme,
}: BranchLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const paletteRef = useRef<TreePalette | null>(null);

  const highlightUnionsRef = useRef(highlightUnions);
  const highlightPeopleRef = useRef(highlightPeople);
  const hasSelectionRef = useRef(hasSelection);
  const focusRef = useRef(focus);
  focusRef.current = focus;
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

    // La brise.
    //
    // Elle n'avance que lorsque la vue est immobile : pendant un déplacement,
    // le décor bouge déjà bien assez, et repeindre en continu coûterait des
    // images à un mouvement que personne ne remarquerait. À l'arrêt en
    // revanche, c'est ce léger balancement qui distingue une scène vivante
    // d'une capture d'écran.
    let breeze = 0;
    let breezeFrame = 0;
    let lastTick = 0;

    // Un balancement lent n'a pas besoin de soixante images par seconde. En
    // repeindre vingt suffit à le voir couler, et rend les deux tiers du temps
    // de calcul — sur une scène qui, sinon, tournerait en permanence.
    const BREEZE_INTERVAL = 50;
    let lastPaint = 0;

    const animateBreeze = (now: number): void => {
      const delta = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 0;
      lastTick = now;
      breeze += delta;
      if (now - lastPaint >= BREEZE_INTERVAL) {
        lastPaint = now;
        schedule();
      }
      breezeFrame = requestAnimationFrame(animateBreeze);
    };

    const startBreeze = (): void => {
      if (breezeFrame) return;
      lastTick = 0;
      breezeFrame = requestAnimationFrame(animateBreeze);
    };

    const stopBreeze = (): void => {
      if (!breezeFrame) return;
      cancelAnimationFrame(breezeFrame);
      breezeFrame = 0;
    };

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
        time: breeze,
        focus: focusRef.current,
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
      stopBreeze();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        moving = false;
        schedule();
        startBreeze();
      }, 170);
      schedule();
    };

    startBreeze();
    const unsubscribeViewport = viewport.subscribe(onViewportChange);
    const unsubscribeHover = hoverStore.subscribe(schedule);

    return () => {
      observer.disconnect();
      unsubscribeViewport();
      unsubscribeHover();
      window.clearTimeout(settleTimer);
      stopBreeze();
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
  }, [highlightUnions, highlightPeople, hasSelection, focus, theme, viewport]);

  return <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />;
}
