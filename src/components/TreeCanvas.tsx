import { useCallback, useEffect, useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { NodePosition, TreeLayout } from '@/domain/layout';
import type { HighlightSet, RelationPath } from '@/domain/relations';
import type { SpatialIndex } from '@/view/spatial';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import type { HoverStore } from '@/view/hover-store';
import { LOD_COMPACT, LOD_FULL } from '@/view/metrics';
import { PersonNode, type NodeDetail } from './PersonNode';
import { LinkLayer } from './LinkLayer';
import { PathFlow } from './PathFlow';

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
  /** Personnes du chemin de parenté courant. */
  pathPeople?: Set<string>;
  /** Unions traversées par ce chemin. */
  pathUnions?: Set<string>;
  /** Le chemin complet, ordonné — pour animer la lumière qui le parcourt. */
  relation?: RelationPath;
  /** Union tout juste créée : son trait se dessine au lieu d'apparaître d'un coup. */
  growingUnionId?: string | null;
}

interface VisibleState {
  nodes: NodePosition[];
  detail: NodeDetail | 'none';
}

const EMPTY_VISIBLE: VisibleState = { nodes: [], detail: 'none' };

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
  pathPeople,
  pathUnions,
  relation,
  growingUnionId,
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
    // Transform au dernier recensement des cartes visibles.
    let committed: { x: number; y: number; scale: number } | null = null;

    const commitVisible = (): void => {
      pending = 0;
      const box = stage.getBoundingClientRect();
      const transform = viewport.transform;

      // Le recensement n'a pas à suivre chaque image.
      //
      // Il interroge l'index spatial, trie le résultat et, quand la liste
      // change, remonte un état à React qui monte et démonte des dizaines de
      // médaillons. À pleine vitesse, cela peut arriver soixante fois par
      // seconde pour un déplacement de quelques pixels.
      //
      // Les cartes vivent dans le conteneur transformé : elles suivent le
      // déplacement toutes seules. Seule la *liste* doit être rafraîchie, et
      // comme on recense large — deux cent quatre-vingts pixels au-delà du
      // cadre — on peut laisser la vue prendre cent pixels d'avance avant d'y
      // revenir. Personne ne peut voir la différence ; la machine, si.
      if (
        committed !== null &&
        committed.scale === transform.scale &&
        Math.abs(committed.x - transform.x) < 100 &&
        Math.abs(committed.y - transform.y) < 100
      ) {
        return;
      }
      committed = { x: transform.x, y: transform.y, scale: transform.scale };

      const detail = detailForScale(transform.scale);
      const rect = visibleRect(transform, { width: box.width, height: box.height }, 280);
      const nodes = detail === 'none' ? [] : spatial.visibleNodes(rect);
      nodes.sort((a, b) => a.y - b.y || a.x - b.x);

      const previous = visibleRef.current;
      if (previous.detail === detail && sameNodes(previous.nodes, nodes)) {
        return;
      }
      setVisible({ nodes, detail });
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
      // Le cadre a changé de taille : le recensement doit être refait même si
      // la vue, elle, n'a pas bougé d'un pixel.
      committed = null;
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

      const step = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
      const sideways = event.deltaMode === 1 ? event.deltaX * 18 : event.deltaX;

      // Molette crantée ou pavé tactile ?
      //
      // Les deux passent par le même événement, et une souris physique n'a pas
      // de quoi pincer. Une souris envoie un saut isolé, en gros crans ; un
      // pavé tactile envoie un flot de petits déplacements déjà continus. Le
      // volume du cran les sépare — c'est le seul indice disponible, et il
      // suffit à savoir lequel des deux appareils est en jeu.
      const notched = event.deltaMode === 1 || Math.abs(step) >= 42 || Math.abs(sideways) >= 42;

      if (event.ctrlKey || event.metaKey) {
        event.stopPropagation();
        const factor = Math.exp(-step * 0.0022);
        if (notched) viewport.zoomAtSmooth(x, y, factor);
        else viewport.zoomAt(x, y, factor);
        return;
      }

      if (event.shiftKey) {
        if (notched) viewport.panBySmooth(-step, 0);
        else {
          viewport.stopAnimation();
          viewport.panBy(-step, 0);
        }
        return;
      }

      // Souris ou pavé tactile : le geste qu'on attend d'eux n'est pas le même.
      //
      // Un pavé tactile pince pour zoomer et glisse à deux doigts pour
      // déplacer la vue — c'est déjà le geste naturel, et le laisser faire
      // continue de parcourir l'arbre comme on tourne les pages d'un plan.
      // Une souris, elle, n'a que sa molette : sur un si grand plan, en faire
      // un défilement plutôt qu'un zoom est le contraire de ce que chacun a
      // appris de toutes les cartes et de toutes les visionneuses qu'il a
      // ouvertes. Le cran de la molette suffit à distinguer les deux, sans
      // qu'aucun des deux gestes n'ait besoin d'une touche supplémentaire.
      if (notched) {
        viewport.zoomAtSmooth(x, y, Math.exp(-step * 0.0022));
        return;
      }

      viewport.stopAnimation();
      viewport.panBy(-sideways, -step);
    };

    const onDoubleClick = (event: MouseEvent): void => {
      const rect = stage.getBoundingClientRect();
      // Un double-clic double presque l'échelle : d'un coup, on ne sait plus où
      // l'on a atterri. Trois cent vingt millisecondes suffisent à ce que
      // l'œil suive le point qu'il visait.
      viewport.zoomAtSmooth(event.clientX - rect.left, event.clientY - rect.top, 1.75, 320);
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


  const hasSelection = highlight.people.size > 0;

  const detail = visible.detail;

  return (
    <div
      ref={stageRef}
      className="stage"
      data-grabbing={grabbing || undefined}
      aria-label="Arbre généalogique"
      onClick={handleBackgroundClick}
    >
      <div ref={worldRef} className="world">
        <LinkLayer
          stageRef={stageRef}
          viewport={viewport}
          layout={layout}
          spatial={spatial}
          highlightUnions={highlight.unions}
          hasSelection={hasSelection}
          theme={theme}
          pathUnions={pathUnions}
          growingUnionId={growingUnionId}
        />

        <PathFlow layout={layout} relation={relation} />

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
                branch={layout.branchOf.get(node.id)}
                onPath={pathPeople?.has(node.id) || undefined}
                onSelect={handleSelect}
                onHover={handleHover}
              />
            );
          })}
      </div>
    </div>
  );
}
