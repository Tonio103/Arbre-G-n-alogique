import type { Bounds } from '@/domain/layout';
import { FIT_PADDING, MAX_SCALE, MIN_SCALE } from './metrics';
import type { Rect } from './spatial';

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const toWorld = (transform: Transform, screenX: number, screenY: number) => ({
  x: (screenX - transform.x) / transform.scale,
  y: (screenY - transform.y) / transform.scale,
});

export function visibleRect(transform: Transform, size: Size, overscan = 0): Rect {
  const topLeft = toWorld(transform, -overscan, -overscan);
  const bottomRight = toWorld(transform, size.width + overscan, size.height + overscan);
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}

/** Transform qui cadre `bounds` dans `size`, sans dépasser les limites de zoom. */
export function transformForBounds(
  bounds: Bounds,
  size: Size,
  padding = FIT_PADDING,
  maxScale = 1,
): Transform {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = clampScale(
    Math.min(
      (size.width - padding * 2) / width,
      (size.height - padding * 2) / height,
      maxScale,
    ),
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    x: size.width / 2 - centerX * scale,
    y: size.height / 2 - centerY * scale,
  };
}

/**
 * Transform qui amène un point du monde au centre de la zone libre.
 * `offsetRight` réserve la place occupée par le panneau de détails, pour que la
 * personne sélectionnée ne finisse pas cachée derrière.
 */
export function transformForPoint(
  worldX: number,
  worldY: number,
  size: Size,
  scale: number,
  offsetRight = 0,
): Transform {
  const safeScale = clampScale(scale);
  return {
    scale: safeScale,
    x: (size.width - offsetRight) / 2 - worldX * safeScale,
    y: size.height / 2 - worldY * safeScale,
  };
}

const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

interface Animation {
  from: Transform;
  to: Transform;
  start: number;
  duration: number;
  ease: (t: number) => number;
  onDone?: () => void;
}

type Listener = (transform: Transform, interacting: boolean) => void;

export interface ViewportOptions {
  /** Limites du monde, pour empêcher de perdre l'arbre hors écran. */
  bounds: Bounds;
}

/**
 * Navigation dans le monde : pan, zoom, inertie et déplacements animés.
 *
 * Volontairement hors de React — la transform change à chaque image et
 * traverser l'état React à cette fréquence coûterait bien plus cher que le
 * rendu lui-même. Les composants s'abonnent et écrivent dans le DOM.
 */
export class ViewportController {
  transform: Transform = { x: 0, y: 0, scale: 1 };
  size: Size = { width: 1, height: 1 };

  private bounds: Bounds;
  private readonly listeners = new Set<Listener>();

  private animation: Animation | null = null;
  private velocityX = 0;
  private velocityY = 0;
  private frame = 0;
  private lastFrameTime = 0;
  private interacting = false;

  constructor(options: ViewportOptions) {
    this.bounds = options.bounds;
  }

  /** Plusieurs couches suivent la transform : les cartes, les liens, la minicarte. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
  }

  setSize(size: Size): void {
    this.size = size;
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.transform, this.interacting);
  }

  /**
   * Empêche l'arbre de disparaître : le cadre visible doit toujours croiser
   * l'arbre, avec une marge d'une demi-fenêtre pour rester confortable.
   */
  private clampTransform(transform: Transform): Transform {
    const marginX = this.size.width * 0.55;
    const marginY = this.size.height * 0.55;
    const scale = transform.scale;

    const minX = this.size.width - marginX - this.bounds.maxX * scale;
    const maxX = marginX - this.bounds.minX * scale;
    const minY = this.size.height - marginY - this.bounds.maxY * scale;
    const maxY = marginY - this.bounds.minY * scale;

    return {
      scale,
      x: Math.min(maxX, Math.max(minX, transform.x)),
      y: Math.min(maxY, Math.max(minY, transform.y)),
    };
  }

  set(transform: Transform, options?: { clamp?: boolean }): void {
    const scale = clampScale(transform.scale);
    const next = { ...transform, scale };
    this.transform = options?.clamp === false ? next : this.clampTransform(next);
    this.emit();
  }

  panBy(dx: number, dy: number): void {
    this.stopAnimation();
    this.set({
      scale: this.transform.scale,
      x: this.transform.x + dx,
      y: this.transform.y + dy,
    });
  }

  /** Zoom en gardant fixe le point de l'écran visé (curseur ou centre du pinch). */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    this.stopAnimation();
    const scale = clampScale(this.transform.scale * factor);
    const applied = scale / this.transform.scale;
    this.set({
      scale,
      x: screenX - (screenX - this.transform.x) * applied,
      y: screenY - (screenY - this.transform.y) * applied,
    });
  }

  /**
   * Le même zoom, mais glissé.
   *
   * Un cran de molette vaut vingt pour cent d'échelle : appliqué d'un coup,
   * l'arbre saute, et enchaîner les crans donne une succession de secousses.
   * Amené en cent soixante millisecondes, le même cran devient un mouvement —
   * et comme chaque nouveau cran repart de la cible en cours et non de l'image
   * affichée, une roulée continue accélère au lieu de se contredire.
   *
   * Un pavé tactile, lui, envoie des dizaines de très petits crans par seconde :
   * les animer ajouterait un retard à un geste déjà continu. C'est à l'appelant
   * de distinguer les deux.
   */
  zoomAtSmooth(screenX: number, screenY: number, factor: number, duration = 170): void {
    const base = this.animation ? this.animation.to : this.transform;
    const scale = clampScale(base.scale * factor);
    const applied = scale / base.scale;
    this.animateTo(
      {
        scale,
        x: screenX - (screenX - base.x) * applied,
        y: screenY - (screenY - base.y) * applied,
      },
      duration,
      'out',
    );
  }

  /**
   * Défilement glissé, pour la molette crantée.
   *
   * Même raison : une souris envoie des sauts de cent pixels. Les enchaîner
   * sans les lisser donne une lecture par à-coups, alors que l'arbre se
   * parcourt du regard.
   */
  panBySmooth(dx: number, dy: number, duration = 200): void {
    const base = this.animation ? this.animation.to : this.transform;
    this.animateTo({ scale: base.scale, x: base.x + dx, y: base.y + dy }, duration, 'out');
  }

  /** Boutons + et − : le zoom est glissé, comme au clavier. */
  zoomBy(factor: number): void {
    this.zoomAtSmooth(this.size.width / 2, this.size.height / 2, factor, 240);
  }

  stopAnimation(): void {
    this.animation = null;
    this.velocityX = 0;
    this.velocityY = 0;
  }

  beginInteraction(): void {
    this.interacting = true;
    this.stopAnimation();
  }

  endInteraction(velocityX = 0, velocityY = 0): void {
    this.interacting = false;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    if (Math.abs(velocityX) > 0.015 || Math.abs(velocityY) > 0.015) this.ensureLoop();
    else this.emit();
  }

  animateTo(target: Transform, duration = 720, ease: 'out' | 'inout' = 'out', onDone?: () => void): void {
    const to = this.clampTransform({ ...target, scale: clampScale(target.scale) });
    this.velocityX = 0;
    this.velocityY = 0;
    this.animation = {
      from: { ...this.transform },
      to,
      start: performance.now(),
      duration: Math.max(1, duration),
      ease: ease === 'out' ? easeOutQuint : easeInOutCubic,
      onDone,
    };
    this.ensureLoop();
  }

  private ensureLoop(): void {
    if (this.frame) return;
    this.lastFrameTime = performance.now();
    const step = (now: number): void => {
      this.frame = 0;
      const delta = Math.min(now - this.lastFrameTime, 64);
      this.lastFrameTime = now;
      let running = false;

      if (this.animation) {
        const progress = Math.min(1, (now - this.animation.start) / this.animation.duration);
        const eased = this.animation.ease(progress);
        const { from, to } = this.animation;
        // Interpolation du zoom en échelle logarithmique : sans cela, un grand
        // écart de zoom donne une impression d'accélération irrégulière.
        const scale = from.scale * Math.pow(to.scale / from.scale, eased);
        this.transform = {
          scale,
          x: from.x + (to.x - from.x) * eased,
          y: from.y + (to.y - from.y) * eased,
        };
        this.emit();
        if (progress >= 1) {
          const done = this.animation.onDone;
          this.animation = null;
          done?.();
        } else {
          running = true;
        }
      } else if (Math.abs(this.velocityX) > 0.015 || Math.abs(this.velocityY) > 0.015) {
        // L'inertie s'éteignait en deux dixièmes de seconde : le geste
        // s'arrêtait presque avec le doigt, et on perdait ce qui fait qu'une
        // carte se manipule — le fait qu'elle continue.
        const decay = Math.pow(0.962, delta / 16.6667);
        this.velocityX *= decay;
        this.velocityY *= decay;
        const next = this.clampTransform({
          scale: this.transform.scale,
          x: this.transform.x + this.velocityX * delta,
          y: this.transform.y + this.velocityY * delta,
        });
        // Le clamp a bloqué le mouvement : inutile de continuer à glisser.
        if (next.x === this.transform.x) this.velocityX = 0;
        if (next.y === this.transform.y) this.velocityY = 0;
        this.transform = next;
        this.emit();
        running = Math.abs(this.velocityX) > 0.015 || Math.abs(this.velocityY) > 0.015;
      }

      if (running) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  fit(bounds: Bounds, padding = FIT_PADDING, maxScale = 1, duration = 760): void {
    this.animateTo(transformForBounds(bounds, this.size, padding, maxScale), duration, 'inout');
  }

  /** Amène un point du monde au centre, en réservant `offsetRight` pour le panneau latéral. */
  focusPoint(
    worldX: number,
    worldY: number,
    scale = Math.max(this.transform.scale, 0.9),
    offsetRight = 0,
    duration = 760,
  ): void {
    this.animateTo(
      transformForPoint(worldX, worldY, this.size, scale, offsetRight),
      duration,
      'inout',
    );
  }
}
