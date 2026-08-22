import { useCallback, useEffect, useRef } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { OrbitLayout } from '@/domain/orbit';
import {
  clampDistance,
  clampPitch,
  type Camera,
} from '@/view/camera';
import { drawScene, type ScenePalette } from '@/view/scene3d';
import type { Projected } from '@/view/camera';

export interface OrbitSceneProps {
  graph: FamilyGraph;
  layout: OrbitLayout;
  highlighted: Set<string>;
  hasSelection: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Change quand le thème change : la palette est relue. */
  theme: string;
}

function readPalette(): ScenePalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    skyTop: read('--sky-top', '#0b1020'),
    skyBottom: read('--sky-bottom', '#16233f'),
    ground: read('--soil', 'rgba(92, 72, 50, 0.9)'),
    groundEdge: read('--soil-deep', 'rgba(40, 32, 24, 0.9)'),
    wood: read('--wood-trunk', '#9a7550'),
    woodLight: read('--wood-light', 'rgba(255, 236, 206, 0.5)'),
    leaf: read('--leaf', '#7ba86f'),
    leafAlt: read('--leaf-alt', '#5f8f5c'),
    leafLit: read('--leaf-lit', '#a8d18c'),
    haze: read('--sky-top', 'rgba(10, 16, 32, 0.6)'),
    link: read('--link-marriage', 'rgba(210, 190, 160, 0.75)'),
    accent: read('--accent', '#5b8cff'),
    dim: read('--wood-dim', 'rgba(120, 100, 80, 0.35)'),
  };
}

/**
 * L'arbre en trois dimensions, et la caméra qui tourne autour.
 *
 * Toute la scène tient sur un seul canevas : le bois, le feuillage et les
 * personnes y sont peints dans le même tri de profondeur. C'est ce qui permet
 * à quelqu'un placé derrière le tronc de passer derrière le tronc — un calque
 * de médaillons en éléments de page, flottant au-dessus, aurait annulé la
 * profondeur au moment même où on l'obtient.
 */
export function OrbitScene({
  graph,
  layout,
  highlighted,
  hasSelection,
  selectedId,
  onSelect,
  theme,
}: OrbitSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenRef = useRef<Map<string, Projected>>(new Map());
  const hoveredRef = useRef<string | null>(null);
  const paletteRef = useRef<ScenePalette | null>(null);

  const cameraRef = useRef<Camera>({
    yaw: 0.7,
    pitch: 0.2,
    distance: 25,
    target: { x: 0, y: 7.6, z: 0 },
    fov: 0.85,
  });

  // Les valeurs qui changent à chaque image passent par des refs : les faire
  // transiter par l'état de React coûterait bien plus que le rendu lui-même.
  const stateRef = useRef({ highlighted, hasSelection, selectedId });
  stateRef.current = { highlighted, hasSelection, selectedId };

  useEffect(() => {
    paletteRef.current = readPalette();
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return undefined;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let frame = 0;
    let moving = false;
    let settle = 0;
    const started = performance.now();

    // Une lente rotation d'accueil, jusqu'au premier geste.
    //
    // Une scène en trois dimensions immobile est indiscernable d'une image :
    // c'est le déplacement du point de vue, et lui seul, qui révèle la
    // profondeur. Quelques degrés suffisent, et le premier contact y met fin —
    // au-delà, ce n'est plus une présentation, c'est un manège.
    let drifting = true;

    const resize = (): void => {
      const box = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, moving ? 1.4 : 2);
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const render = (now: number): void => {
      frame = 0;
      const time = (now - started) / 1000;
      if (drifting) cameraRef.current.yaw = 0.7 + time * 0.055;

      const { screen } = drawScene(context, {
        layout,
        camera: cameraRef.current,
        width,
        height,
        dpr,
        palette: paletteRef.current ?? readPalette(),
        highlighted: stateRef.current.highlighted,
        hasSelection: stateRef.current.hasSelection,
        selectedId: stateRef.current.selectedId,
        hoveredId: hoveredRef.current,
        time,
        detailed: !moving,
        label: (id) => {
          const person = graph.people.get(id);
          return person ? { initials: person.initials, name: person.displayName } : null;
        },
      });
      screenRef.current = screen;
      frame = requestAnimationFrame(render);
    };

    resize();
    frame = requestAnimationFrame(render);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // --- Gestes ------------------------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let lastX = 0;
    let lastY = 0;
    let travelled = 0;
    let pinch = 0;

    const markMoving = (): void => {
      moving = true;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        moving = false;
        resize();
      }, 200);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      drifting = false;
      travelled = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const box = canvas.getBoundingClientRect();

      if (!pointers.has(event.pointerId)) {
        // Survol : la personne dont le disque contient le pointeur, la plus
        // proche de l'œil quand plusieurs se recouvrent.
        const found = pick(event.clientX - box.left, event.clientY - box.top);
        if (found !== hoveredRef.current) {
          hoveredRef.current = found;
          canvas.style.cursor = found ? 'pointer' : 'grab';
        }
        return;
      }

      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      markMoving();

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const next = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && next > 0) {
          cameraRef.current.distance = clampDistance(cameraRef.current.distance * (pinch / next));
        }
        pinch = next;
        travelled = 99;
        return;
      }

      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);

      // Un tour complet pour une largeur d'écran : c'est le rapport qui rend
      // le geste prévisible, quelle que soit la taille du cadre.
      cameraRef.current.yaw -= (dx / Math.max(1, box.width)) * Math.PI * 2;
      cameraRef.current.pitch = clampPitch(
        cameraRef.current.pitch + (dy / Math.max(1, box.height)) * 2.2,
      );
    };

    const pick = (x: number, y: number): string | null => {
      let best: string | null = null;
      let bestDepth = Infinity;
      for (const [id, projected] of screenRef.current) {
        const radius = Math.max(7, Math.min(30, 0.15 * projected.scale));
        if (Math.hypot(projected.x - x, projected.y - y) > radius) continue;
        if (projected.depth < bestDepth) {
          bestDepth = projected.depth;
          best = id;
        }
      }
      return best;
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (!pointers.delete(event.pointerId)) return;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      pinch = 0;
      // Un pivot n'est pas un clic.
      if (travelled > 6) return;
      const box = canvas.getBoundingClientRect();
      onSelect(pick(event.clientX - box.left, event.clientY - box.top));
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      drifting = false;
      markMoving();
      const step = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
      cameraRef.current.distance = clampDistance(
        cameraRef.current.distance * Math.exp(step * 0.0014),
      );
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.style.cursor = 'grab';

    return () => {
      observer.disconnect();
      window.clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [graph, layout, onSelect]);

  const focus = useCallback(
    (id: string) => {
      const person = layout.people.get(id);
      if (!person) return;
      cameraRef.current.yaw = -person.angle + Math.PI / 2;
      cameraRef.current.target.y = person.height;
      cameraRef.current.distance = clampDistance(6);
    },
    [layout],
  );

  useEffect(() => {
    if (selectedId) focus(selectedId);
  }, [selectedId, focus]);

  return <canvas ref={canvasRef} className="orbit-canvas" />;
}
