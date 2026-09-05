import { useEffect, useRef, type RefObject } from 'react';
import type { TreeLayout } from '@/domain/layout';
import type { Rect, SpatialIndex } from '@/view/spatial';
import type { EtatBotanique } from '@/domain/gaps';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import { drawLinks, type LinkPalette } from '@/view/links';

export interface LinkLayerProps {
  stageRef: RefObject<HTMLDivElement | null>;
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
  /** Union tout juste créée (nouveau proche ajouté) : son trait se dessine
   *  au lieu d'apparaître d'un coup — voir `GROWTH_MS` plus bas. */
  growingUnionId?: string | null;
  /** L'état botanique de chaque fiche, pour feuiller les branches. */
  etats: Map<string, EtatBotanique>;
}

/** Durée de l'apparition d'un trait tout juste créé. */
const GROWTH_MS = 640;

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
 * Tant que le cadre visible reste dans cette marge, l'échelle affichée peut
 * s'écarter de celle du dernier dessin sans que le trait perde en netteté au
 * point qu'on le remarque.
 *
 * Large délibérément. Une molette qu'on tourne vite change l'échelle en
 * continu — la resserrer forçait un redessin presque à chaque cran, ce qui
 * annulait justement le bénéfice de ne plus redessiner à chaque image. Une
 * légère perte de netteté pendant un geste rapide ne se voit de toute façon
 * pas : l'œil ne résout pas un trait fin au milieu d'un mouvement qu'il ne
 * peut lui-même pas suivre.
 */
const SCALE_DRIFT = 2.2;

/**
 * Les traits de filiation, sur un canevas unique.
 *
 * Rendu dans les coordonnées du monde, à l'intérieur même de `.world` : le
 * canevas hérite du `transform: translate3d() scale()` du conteneur comme
 * n'importe quelle carte, et suivre un déplacement ne coûte donc rien de
 * plus qu'à elles — aucune image à refaire, seulement une recomposition que
 * le compositeur du navigateur gère déjà pour les cartes.
 *
 * Redessiner refait tout le tracé — bandes, traits, jalons — quel que soit
 * le nombre d'unions concernées : coûteux si c'est fait à chaque image d'un
 * geste qui dure, comme un défilement à la molette. On ne le refait donc
 * que quand le cadre visible sort de la zone déjà couverte (dessinée avec
 * une marge généreuse) ou que l'échelle a trop dérivé pour rester nette —
 * jamais à chaque image d'un mouvement continu.
 */
export function LinkLayer({
  stageRef,
  viewport,
  layout,
  spatial,
  highlightUnions,
  hasSelection,
  pathUnions,
  theme,
  growingUnionId,
  etats,
}: LinkLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const paletteRef = useRef<LinkPalette | null>(null);
  const forceRef = useRef<(() => void) | null>(null);
  const growthRef = useRef<{ unionId: string; start: number } | null>(null);

  const stateRef = useRef({ highlightUnions, hasSelection, pathUnions, etats });
  stateRef.current = { highlightUnions, hasSelection, pathUnions, etats };

  useEffect(() => {
    paletteRef.current = readPalette(theme);
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return undefined;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return undefined;

    let stageSize = { width: 1, height: 1 };
    let dpr = 1;
    // La zone du monde déjà couverte par le tampon du canevas, et la densité
    // (pixels de canevas par unité du monde) à laquelle elle a été dessinée.
    let committed: { rect: Rect; density: number } | null = null;

    const redraw = (): void => {
      const transform = viewport.transform;
      /*
       * Marge de pré-rendu : assez pour qu'un glissement ordinaire ne
       * redessine pas à chaque image, pas au point de multiplier le coût de
       * chaque redessin par neuf. La zone couverte croît au carré de cette
       * marge (deux dimensions) — mesuré, une marge d'une pleine fenêtre
       * revenait à dessiner neuf fois plus d'unions qu'affiché, ce qui
       * finissait par coûter plus cher que le gain de fréquence ne rapportait
       * pendant un zoom soutenu.
       */
      const overscan = Math.max(stageSize.width, stageSize.height) * 0.5;
      const rect = visibleRect(transform, stageSize, overscan);

      committed = { rect, density: transform.scale };

      const worldWidth = Math.max(1, rect.right - rect.left);
      const worldHeight = Math.max(1, rect.bottom - rect.top);
      canvas.style.left = `${rect.left}px`;
      canvas.style.top = `${rect.top}px`;
      canvas.style.width = `${worldWidth}px`;
      canvas.style.height = `${worldHeight}px`;
      canvas.width = Math.round(worldWidth * transform.scale * dpr);
      canvas.height = Math.round(worldHeight * transform.scale * dpr);

      drawLinks(context, {
        unions: spatial.visibleUnions(rect),
        rows: layout.rows,
        worldRect: rect,
        density: transform.scale,
        dpr,
        palette: paletteRef.current ?? readPalette(theme),
        highlighted: stateRef.current.highlightUnions,
        hasSelection: stateRef.current.hasSelection,
        pathUnions: stateRef.current.pathUnions,
        etats: stateRef.current.etats,
        growth: growthRef.current
          ? {
              unionId: growthRef.current.unionId,
              progress: Math.min(1, (performance.now() - growthRef.current.start) / GROWTH_MS),
            }
          : undefined,
      });
    };

    const maybeRedraw = (force = false): void => {
      frameRef.current = 0;
      if (force || !committed) {
        redraw();
        return;
      }
      const transform = viewport.transform;
      // Petite marge de sécurité, pour redessiner un peu avant d'être
      // réellement à court plutôt qu'exactement à la limite.
      const safety = 24;
      const visible = visibleRect(transform, stageSize, safety);
      const scaleDrift = transform.scale / committed.density;
      const outOfBounds =
        visible.left < committed.rect.left ||
        visible.right > committed.rect.right ||
        visible.top < committed.rect.top ||
        visible.bottom > committed.rect.bottom;
      const scaleStale = scaleDrift > SCALE_DRIFT || scaleDrift < 1 / SCALE_DRIFT;
      if (outOfBounds || scaleStale) redraw();
    };

    const schedule = (force = false): void => {
      if (force) {
        // Une sélection ou un changement de thème doit repeindre au prochain
        // image, sans attendre une dérive qui n'arrivera peut-être jamais.
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => maybeRedraw(true));
        return;
      }
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => maybeRedraw(false));
    };

    const resize = (): void => {
      const box = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      stageSize = { width: Math.max(1, box.width), height: Math.max(1, box.height) };
      // Le cadre a changé de taille : la zone déjà couverte n'a plus de sens.
      committed = null;
      schedule(true);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    const unsubscribe = viewport.subscribe(() => schedule(false));
    forceRef.current = () => schedule(true);

    return () => {
      observer.disconnect();
      unsubscribe();
      forceRef.current = null;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
    // La palette et l'état de sélection sont lus depuis des refs à l'instant
    // du dessin : cet effet ne doit se relancer que si le monde lui-même
    // change de forme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, layout, spatial, stageRef]);

  // Une sélection ou un changement de thème doit repeindre immédiatement —
  // même si le cadre visible, lui, n'a pas bougé d'un pixel.
  useEffect(() => {
    forceRef.current?.();
  }, [highlightUnions, hasSelection, pathUnions, theme]);

  // L'apparition d'un trait tout juste créé : redessine à chaque image
  // pendant `GROWTH_MS`, puis relâche — le reste du temps, `LinkLayer` ne
  // redessine que quand la vue bouge (voir plus haut), pas à chaque image.
  useEffect(() => {
    if (!growingUnionId) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    growthRef.current = { unionId: growingUnionId, start: performance.now() };
    if (reduced) {
      growthRef.current = null;
      forceRef.current?.();
      return undefined;
    }

    let frame = 0;
    const tick = (): void => {
      forceRef.current?.();
      if (growthRef.current && performance.now() - growthRef.current.start < GROWTH_MS) {
        frame = requestAnimationFrame(tick);
      } else {
        growthRef.current = null;
        forceRef.current?.();
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      growthRef.current = null;
    };
  }, [growingUnionId]);

  return <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />;
}
