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
    soil: read('--soil', 'rgba(126, 100, 70, 0.7)'),
    soilDeep: read('--soil-deep', 'rgba(96, 74, 52, 0.42)'),
    soilGrain: read('--soil-grain', 'rgba(74, 54, 34, 0.22)'),
    groundShade: read('--ground-shade', 'rgba(60, 66, 52, 0.16)'),
    stone: read('--stone', 'rgba(196, 194, 188, 0.85)'),
    stoneShade: read('--stone-shade', 'rgba(126, 124, 118, 0.8)'),
    grass: read('--grass', 'rgba(108, 152, 92, 0.85)'),
    grassAlt: read('--grass-alt', 'rgba(82, 122, 76, 0.7)'),
    bloom: read('--bloom', 'rgba(240, 196, 120, 0.95)'),
    bloomAlt: read('--bloom-alt', 'rgba(216, 152, 190, 0.9)'),
    bloomHeart: read('--bloom-heart', 'rgba(246, 190, 78, 0.95)'),
    sunDapple: read('--sun-dapple', 'rgba(255, 246, 214, 0.5)'),
    mote: read('--mote', 'rgba(228, 196, 132, 0.62)'),
    petal: read('--petal', 'rgba(232, 158, 186, 0.6)'),
    petalAlt: read('--petal-alt', 'rgba(224, 196, 132, 0.55)'),
    bird: read('--bird', 'rgba(52, 64, 88, 0.3)'),
    cloud: read('--cloud', 'rgba(255, 255, 255, 0.92)'),
    cloudShade: read('--cloud-shade', 'rgba(178, 196, 232, 0.5)'),
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

    // La cadence de la brise s'ajuste à ce qu'elle coûte.
    //
    // Un balancement lent n'a pas besoin de soixante images par seconde : vingt
    // suffisent à le voir couler. Mais « vingt » n'a de sens que si une image
    // coûte peu. Sur la vue d'ensemble, repeindre l'arbre entier prend dix fois
    // plus de temps que sur une famille — et la même cadence mangeait alors
    // tout le budget d'une machine au repos, juste avant que l'utilisateur ne
    // pose la main sur la souris.
    //
    // La règle : la brise ne s'accorde qu'un quart du temps. On mesure ce que
    // coûte une image et on espace les suivantes en conséquence, entre vingt
    // fois par seconde et cinq. Le décor reste vivant partout, et nulle part il
    // ne prend la place du geste.
    const BREEZE_MIN = 50;
    const BREEZE_MAX = 230;
    let breezeInterval = BREEZE_MIN;
    let paintCost = 0;
    let lastPaint = 0;

    const animateBreeze = (now: number): void => {
      const delta = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 0;
      lastTick = now;
      breeze += delta;
      if (now - lastPaint >= breezeInterval) {
        lastPaint = now;
        schedule();
      }
      breezeFrame = requestAnimationFrame(animateBreeze);
    };

    // Une scène qui bouge sans qu'on l'ait demandé n'est pas un agrément pour
    // tout le monde : le réglage système fait foi, et la brise s'arrête net.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const startBreeze = (): void => {
      if (breezeFrame || calm) return;
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
      const unions = spatial.visibleUnions(rect);
      const hovered = hoverStore.getSnapshot();
      const accentUnions = new Set(highlightUnionsRef.current);
      if (hovered) {
        for (const unionId of layout.unionsByPerson.get(hovered) ?? []) accentUnions.add(unionId);
      }

      drawTree(context, {
        unions,
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

      // La cadence se règle sur la quantité de bois à l'écran, pas sur le temps
      // mesuré ici : les commandes d'un canevas sont enregistrées puis
      // rastérisées ailleurs, si bien qu'une image lourde s'exécute en une
      // milliseconde de JavaScript et coûte trente millisecondes à la machine.
      // Le nombre de branches visibles, lui, est connu tout de suite et suit
      // fidèlement la dépense réelle.
      paintCost = paintCost * 0.6 + unions.length * 0.4;
      breezeInterval = Math.min(BREEZE_MAX, Math.max(BREEZE_MIN, 46 + paintCost * 0.7));
    };

    const schedule = (): void => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(paint);
    };

    /**
     * Définition de rendu du canevas.
     *
     * Au repos, la densité de l'écran, plafonnée à deux : le bois doit être net
     * quand on le regarde. En mouvement, plafonnée à 1,35 — moitié moins de
     * pixels à peindre sur un écran à deux fois la densité, cinq fois moins sur
     * un téléphone à trois fois. La différence ne se voit pas sur une image qui
     * défile : c'est exactement là que le détail ne sert à rien, et exactement
     * là que la fluidité se gagne.
     */
    const renderDpr = (): number => {
      const density = Math.min(window.devicePixelRatio || 1, 2);
      return moving ? Math.min(density, 1.35) : density;
    };

    const resize = (): void => {
      const box = parent.getBoundingClientRect();
      dpr = renderDpr();
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      schedule();
    };

    /** Change la définition sans toucher à la taille affichée. */
    const rescale = (): void => {
      const next = renderDpr();
      if (Math.abs(next - dpr) < 0.01) return;
      dpr = next;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    const onViewportChange = (): void => {
      if (!moving) {
        moving = true;
        // Une seule fois par geste, jamais à chaque image : réallouer le
        // tampon du canevas coûterait plus cher que ce qu'on économise.
        rescale();
      }
      stopBreeze();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        moving = false;
        rescale();
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
