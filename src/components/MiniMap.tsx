import { useEffect, useRef } from 'react';
import type { TreeLayout } from '@/domain/layout';
import type { ViewportController } from '@/view/viewport';
import { visibleRect } from '@/view/viewport';
import { CARD_HEIGHT, CARD_WIDTH } from '@/view/metrics';

export interface MiniMapProps {
  layout: TreeLayout;
  viewport: ViewportController;
  /** Personnes de la branche sélectionnée, marquées en couleur d'accent. */
  highlighted: Set<string>;
  theme: string;
}

const WIDTH = 208;
const HEIGHT = 132;
const PADDING = 8;

/**
 * Vue d'ensemble de l'arbre entier avec le cadre courant.
 * Sur un arbre qui fait plusieurs dizaines de milliers de pixels de large,
 * c'est le seul repère qui dit où l'on se trouve.
 */
export function MiniMap({ layout, viewport, highlighted, theme }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const highlightedRef = useRef(highlighted);
  highlightedRef.current = highlighted;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;

    const { bounds } = layout;
    const worldWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const worldHeight = Math.max(bounds.maxY - bounds.minY, 1);

    // Échelles X et Y indépendantes : un arbre fait typiquement trente fois
    // plus large que haut, et le cadrer à ratio constant le réduirait à un
    // trait de quelques pixels. La déformation est assumée — c'est un repère,
    // pas une reproduction.
    const scaleX = (WIDTH - PADDING * 2) / worldWidth;
    const scaleY = (HEIGHT - PADDING * 2) / worldHeight;
    const offsetX = PADDING - bounds.minX * scaleX;
    const offsetY = PADDING - bounds.minY * scaleY;

    const styles = getComputedStyle(document.documentElement);
    const dotColor = styles.getPropertyValue('--link-node').trim() || 'rgba(190,210,245,0.5)';
    const accentColor = styles.getPropertyValue('--accent').trim() || '#7fb0ff';
    const frameColor = styles.getPropertyValue('--accent-ring').trim() || 'rgba(127,176,255,0.55)';

    const dotSize = 1.35;

    const paint = (): void => {
      frameRef.current = 0;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, WIDTH, HEIGHT);

      const accents = highlightedRef.current;

      context.beginPath();
      for (const position of layout.positions.values()) {
        if (accents.has(position.id)) continue;
        const x = offsetX + (position.x + CARD_WIDTH / 2) * scaleX;
        const y = offsetY + (position.y + CARD_HEIGHT / 2) * scaleY;
        context.moveTo(x + dotSize, y);
        context.arc(x, y, dotSize, 0, Math.PI * 2);
      }
      context.fillStyle = dotColor;
      context.globalAlpha = accents.size > 0 ? 0.4 : 1;
      context.fill();
      context.globalAlpha = 1;

      if (accents.size > 0) {
        context.beginPath();
        for (const position of layout.positions.values()) {
          if (!accents.has(position.id)) continue;
          const x = offsetX + (position.x + CARD_WIDTH / 2) * scaleX;
          const y = offsetY + (position.y + CARD_HEIGHT / 2) * scaleY;
          context.moveTo(x + dotSize * 2, y);
          context.arc(x, y, dotSize * 2, 0, Math.PI * 2);
        }
        context.fillStyle = accentColor;
        context.fill();
      }

      // Cadre de ce qui est actuellement à l'écran.
      const rect = visibleRect(viewport.transform, viewport.size);
      const frameX = offsetX + rect.left * scaleX;
      const frameY = offsetY + rect.top * scaleY;
      const frameW = (rect.right - rect.left) * scaleX;
      const frameH = (rect.bottom - rect.top) * scaleY;

      context.save();
      context.beginPath();
      context.rect(1, 1, WIDTH - 2, HEIGHT - 2);
      context.clip();
      context.strokeStyle = frameColor;
      context.lineWidth = 1.4;
      context.beginPath();
      context.roundRect(frameX, frameY, Math.max(frameW, 4), Math.max(frameH, 4), 3);
      context.stroke();
      context.fillStyle = frameColor;
      context.globalAlpha = 0.12;
      context.fill();
      context.restore();
    };

    const schedule = (): void => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(paint);
    };

    schedule();
    const unsubscribe = viewport.subscribe(schedule);

    // Cliquer ou glisser sur la vue d'ensemble déplace le cadre.
    const goTo = (clientX: number, clientY: number): void => {
      const box = canvas.getBoundingClientRect();
      const worldX = (clientX - box.left - offsetX) / scaleX;
      const worldY = (clientY - box.top - offsetY) / scaleY;
      viewport.focusPoint(worldX, worldY, viewport.transform.scale, 0, 420);
    };

    let dragging = false;
    const onPointerDown = (event: PointerEvent): void => {
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
      goTo(event.clientX, event.clientY);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      goTo(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent): void => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      unsubscribe();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [layout, viewport, theme]);

  // Repeindre quand la branche mise en évidence change.
  useEffect(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      viewport.set(viewport.transform);
    });
  }, [highlighted, viewport]);

  return (
    <div className="minimap glass">
      <canvas
        ref={canvasRef}
        style={{ width: WIDTH, height: HEIGHT }}
        role="img"
        aria-label="Vue d’ensemble de l’arbre"
      />
    </div>
  );
}
