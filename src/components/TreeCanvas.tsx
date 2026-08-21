import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { NodePosition, TreeLayout } from '@/domain/layout';
import type { HighlightSet } from '@/domain/relations';
import type { SpatialIndex } from '@/view/spatial';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import type { HoverStore } from '@/view/hover-store';
import {
  BLUR_BUDGET,
  LOD_COMPACT,
  LOD_FULL,
  cardCenterX,
  portraitCenterY,
} from '@/view/metrics';
import { PersonNode, type NodeDetail } from './PersonNode';
import { BranchLayer } from './BranchLayer';

export interface TreeCanvasProps {
  graph: FamilyGraph;
  layout: TreeLayout;
  spatial: SpatialIndex;
  viewport: ViewportController;
  hoverStore: HoverStore;
  highlight: HighlightSet;
  selectedId: string | null;
  /** Personne mise en avant par la recherche. */
  flaggedId: string | null;
  onSelect: (id: string | null) => void;
  theme: string;
}

interface VisibleState {
  nodes: NodePosition[];
  detail: NodeDetail | 'none';
  cheap: boolean;
}

const EMPTY_VISIBLE: VisibleState = { nodes: [], detail: 'none', cheap: false };

/** Le niveau de détail suit le zoom : texte complet, prénom seul, puis points. */
function detailForScale(scale: number): NodeDetail | 'none' {
  if (scale >= LOD_FULL) return 'full';
  if (scale >= LOD_COMPACT) return 'compact';
  return 'none';
}

function sameNodes(a: NodePosition[], b: NodePosition[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

/**
 * Zone de navigation : gère le déplacement, le zoom et le montage des seules
 * cartes visibles. Le nombre de personnes dans l'arbre n'influe pas sur le
 * coût d'une image — seule compte la surface affichée.
 */
export function TreeCanvas({
  graph,
  layout,
  spatial,
  viewport,
  hoverStore,
  highlight,
  selectedId,
  flaggedId,
  onSelect,
  theme,
}: TreeCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState<VisibleState>(EMPTY_VISIBLE);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const [grabbing, setGrabbing] = useState(false);
  const draggedRef = useRef(false);

  // --- Transform appliquée directement au DOM, hors cycle de rendu React ---
  useEffect(() => {
    const world = worldRef.current;
    const stage = stageRef.current;
    if (!world || !stage) return undefined;

    let pending = 0;

    const commitVisible = (): void => {
      pending = 0;
      const box = stage.getBoundingClientRect();
      const transform = viewport.transform;
      const detail = detailForScale(transform.scale);
      const rect = visibleRect(transform, { width: box.width, height: box.height }, 280);
      const nodes = detail === 'none' ? [] : spatial.visibleNodes(rect);
      nodes.sort((a, b) => a.y - b.y || a.x - b.x);

      const previous = visibleRef.current;
      const cheap = nodes.length > BLUR_BUDGET;
      if (previous.detail === detail && previous.cheap === cheap && sameNodes(previous.nodes, nodes)) {
        return;
      }
      setVisible({ nodes, detail, cheap });
    };

    const apply = (): void => {
      const transform = viewport.transform;
      world.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
      if (!pending) pending = requestAnimationFrame(commitVisible);
    };

    apply();
    const unsubscribe = viewport.subscribe(apply);

    const resize = (): void => {
      const box = stage.getBoundingClientRect();
      viewport.setSize({ width: box.width, height: box.height });
      apply();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    return () => {
      unsubscribe();
      observer.disconnect();
      if (pending) cancelAnimationFrame(pending);
    };
  }, [viewport, spatial]);

  // --- Déplacement, pincement, molette ---
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const pointers = new Map<number, { x: number; y: number }>();
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocityX = 0;
    let velocityY = 0;
    let pinchDistance = 0;

    const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.hypot(a.x - b.x, a.y - b.y);

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      draggedRef.current = false;

      if (pointers.size === 1) {
        panning = true;
        lastX = event.clientX;
        lastY = event.clientY;
        lastTime = event.timeStamp;
        velocityX = 0;
        velocityY = 0;
        viewport.beginInteraction();
        setGrabbing(true);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = distance(a, b);
        panning = false;
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const next = distance(a, b);
        if (pinchDistance > 0 && next > 0) {
          const rect = stage.getBoundingClientRect();
          viewport.zoomAt(
            (a.x + b.x) / 2 - rect.left,
            (a.y + b.y) / 2 - rect.top,
            next / pinchDistance,
          );
        }
        pinchDistance = next;
        draggedRef.current = true;
        return;
      }

      if (!panning) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (!draggedRef.current && Math.hypot(event.clientX - lastX, event.clientY - lastY) > 0) {
        // Seuil : un léger tremblement pendant le clic ne doit pas annuler la sélection.
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          draggedRef.current = true;
          // La capture n'est prise qu'ici, une fois le déplacement avéré.
          //
          // Capturer dès l'appui détourne vers la zone de navigation le clic
          // que le navigateur synthétise après un toucher : sur mobile, appuyer
          // sur une personne n'ouvrait alors jamais sa fiche.
          stage.setPointerCapture(event.pointerId);
        }
      }

      const elapsed = Math.max(1, event.timeStamp - lastTime);
      velocityX = dx / elapsed;
      velocityY = dy / elapsed;
      lastX = event.clientX;
      lastY = event.clientY;
      lastTime = event.timeStamp;
      viewport.panBy(dx, dy);
    };

    const endPointer = (event: PointerEvent): void => {
      if (!pointers.delete(event.pointerId)) return;
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);

      if (pointers.size === 0) {
        if (panning) {
          const idle = event.timeStamp - lastTime > 90;
          viewport.endInteraction(idle ? 0 : velocityX, idle ? 0 : velocityY);
        }
        panning = false;
        pinchDistance = 0;
        setGrabbing(false);
      } else if (pointers.size === 1) {
        const [remaining] = [...pointers.values()];
        panning = true;
        lastX = remaining.x;
        lastY = remaining.y;
        lastTime = event.timeStamp;
        pinchDistance = 0;
      }
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // La molette remonte l'arbre.
      //
      // On parcourt un arbre du pied vers la cime : le geste de lecture est
      // vertical, comme dans une page. Réserver la molette au zoom obligerait à
      // pincer ou à glisser pour changer de génération, alors que c'est le
      // mouvement le plus courant. Le zoom reste accessible avec la touche de
      // commande enfoncée, comme dans n'importe quel plan.
      const step = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;

      if (event.ctrlKey || event.metaKey) {
        event.stopPropagation();
        viewport.zoomAt(x, y, Math.exp(-step * 0.0022));
        return;
      }

      viewport.stopAnimation();
      if (event.shiftKey) {
        viewport.panBy(-step, 0);
        return;
      }

      const sideways = event.deltaMode === 1 ? event.deltaX * 18 : event.deltaX;
      viewport.panBy(-sideways, -step);
    };

    const onDoubleClick = (event: MouseEvent): void => {
      const rect = stage.getBoundingClientRect();
      viewport.zoomAt(event.clientX - rect.left, event.clientY - rect.top, 1.75);
    };

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dblclick', onDoubleClick);

    return () => {
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', endPointer);
      stage.removeEventListener('pointercancel', endPointer);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('dblclick', onDoubleClick);
    };
  }, [viewport]);

  // --- Clavier : déplacement et zoom sans souris ---
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const step = event.shiftKey ? 260 : 90;
      switch (event.key) {
        case 'ArrowLeft':
          viewport.panBy(step, 0);
          break;
        case 'ArrowRight':
          viewport.panBy(-step, 0);
          break;
        case 'ArrowUp':
          viewport.panBy(0, step);
          break;
        case 'ArrowDown':
          viewport.panBy(0, -step);
          break;
        case '+':
        case '=':
          viewport.zoomBy(1.3);
          break;
        case '-':
        case '_':
          viewport.zoomBy(1 / 1.3);
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [viewport],
  );

  const handleSelect = useCallback(
    (id: string) => {
      // Un déplacement de l'arbre ne doit pas se terminer par une sélection.
      if (draggedRef.current) return;
      onSelect(id);
    },
    [onSelect],
  );

  const handleHover = useCallback(
    (id: string | null) => {
      hoverStore.set(id);
    },
    [hoverStore],
  );

  const handleBackgroundClick = useCallback(() => {
    if (draggedRef.current) return;
    onSelect(null);
  }, [onSelect]);

  const highlightPeople = useMemo(
    () => new Set(highlight.people.keys()),
    [highlight],
  );

  const hasSelection = highlight.people.size > 0;

  // Point d'où rayonne le surlignage : le portrait de la personne choisie.
  const focusPoint = useMemo(() => {
    if (!selectedId) return null;
    const position = layout.positions.get(selectedId);
    if (!position) return null;
    return { x: cardCenterX(position.x), y: portraitCenterY(position.y) };
  }, [selectedId, layout]);
  const detail = visible.detail;

  return (
    <div
      ref={stageRef}
      className="stage"
      data-grabbing={grabbing || undefined}
      tabIndex={0}
      role="application"
      aria-label="Arbre généalogique : flèches pour se déplacer, plus et moins pour zoomer"
      onKeyDown={onKeyDown}
      onClick={handleBackgroundClick}
    >
      <BranchLayer
        viewport={viewport}
        layout={layout}
        spatial={spatial}
        hoverStore={hoverStore}
        highlightUnions={highlight.unions}
        highlightPeople={highlightPeople}
        hasSelection={hasSelection}
        focus={focusPoint}
        theme={theme}
      />

      <div ref={worldRef} className="world" data-cheap={visible.cheap || undefined}>
        {detail !== 'none' &&
          visible.nodes.map((node) => {
            const person = graph.people.get(node.id);
            if (!person) return null;
            const role = highlight.people.get(node.id);
            return (
              <PersonNode
                key={node.id}
                person={person}
                x={node.x}
                y={node.y}
                detail={detail}
                role={role}
                dimmed={hasSelection && !role}
                selected={selectedId === node.id}
                flagged={flaggedId === node.id}
                onSelect={handleSelect}
                onHover={handleHover}
              />
            );
          })}
      </div>
    </div>
  );
}
