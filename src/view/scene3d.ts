import type { OrbitLayout, OrbitPerson } from '@/domain/orbit';
import { limbWidth } from '@/domain/orbit';
import { hashN } from '@/lib/hash';
import { makeView, project, projectSegment, type Camera, type Projected, type Vec3 } from './camera';

/*
 * ============================================================================
 *
 *  RENDU DE LA SCÈNE
 *
 *  Tout est peint dans l'ordre du plus lointain au plus proche — l'algorithme
 *  du peintre. C'est le seul tri qui donne la profondeur sans tampon de
 *  profondeur, et il suffit ici : un arbre n'a pas de surfaces qui
 *  s'interpénètrent, seulement des branches qui passent devant d'autres.
 *
 *  La deuxième moitié de la profondeur vient de l'air. Ce qui est loin est
 *  plus pâle et plus froid, parce qu'il y a de l'atmosphère entre l'œil et
 *  lui. Sans cette perte de contraste, une scène projetée reste un schéma en
 *  fil de fer, quelle que soit la justesse de sa perspective.
 *
 * ==========================================================================*/

export interface ScenePalette {
  skyTop: string;
  skyBottom: string;
  ground: string;
  groundEdge: string;
  wood: string;
  woodLight: string;
  leaf: string;
  leafAlt: string;
  leafLit: string;
  /** Teinte vers laquelle fond ce qui est lointain. */
  haze: string;
  link: string;
  accent: string;
  dim: string;
}

export interface SceneParams {
  layout: OrbitLayout;
  camera: Camera;
  width: number;
  height: number;
  dpr: number;
  palette: ScenePalette;
  /** Personnes mises en évidence ; vide quand rien n'est sélectionné. */
  highlighted: Set<string>;
  hasSelection: boolean;
  /** Phase du vent, en secondes. */
  time: number;
  /** Rendu allégé pendant un geste. */
  detailed: boolean;
  /** De quoi étiqueter une personne ; rien pour n'en dessiner aucune. */
  label: (id: string) => { initials: string; name: string } | null;
  selectedId: string | null;
  hoveredId: string | null;
}

/** Ce qu'on peut peindre, avec la profondeur qui décide de son rang. */
interface Sprite {
  depth: number;
  paint: () => void;
}

const AXIS: Vec3 = { x: 0, y: 0, z: 0 };

/*
 * Le bouquet de feuilles, dessiné une fois pour toutes.
 *
 * Trois cents touffes par image, chacune avec son dégradé radial, coûtent plus
 * cher que tout le reste de la scène réunie : un dégradé se construit à chaque
 * appel et ne se réutilise pas. Une seule vignette par teinte, peinte hors
 * écran au premier besoin puis recopiée à l'échelle voulue, donne le même bord
 * mou pour un centième du prix.
 */
const leafSprites = new Map<string, HTMLCanvasElement>();

function leafSprite(color: string): HTMLCanvasElement {
  const cached = leafSprites.get(color);
  if (cached) return cached;

  const size = 128;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  if (ctx) {
    const half = size / 2;
    // Quelques lobes décentrés plutôt qu'un disque : une touffe de feuillage
    // n'a pas de contour circulaire, et c'est ce qui la distingue d'une bille.
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2 + 0.6;
      const distance = i === 0 ? 0 : half * 0.3;
      const radius = half * (i === 0 ? 0.62 : 0.44);
      const cx = half + Math.cos(angle) * distance;
      const cy = half + Math.sin(angle) * distance * 0.8;
      const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      wash.addColorStop(0, color);
      wash.addColorStop(0.55, color);
      wash.addColorStop(1, 'transparent');
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  leafSprites.set(color, sprite);
  return sprite;
}

/**
 * Position d'une personne, avec le balancement du vent.
 *
 * Le déplacement croît avec la hauteur et décroît avec ce que la branche
 * porte : le fût ne bouge pas, les rameaux oscillent. C'est ce rapport, et non
 * l'amplitude, qui fait lire un arbre plutôt qu'une image qui tremble.
 */
function sway(person: OrbitPerson, time: number): Vec3 {
  const amplitude = (0.035 * person.height) / Math.sqrt(1 + person.weight);
  const phase = time * 0.7 + person.angle * 1.6 + person.height * 0.35;
  return {
    x: person.x + Math.sin(phase) * amplitude,
    y: person.y + Math.sin(phase * 0.6) * amplitude * 0.22,
    z: person.z + Math.cos(phase * 0.9) * amplitude,
  };
}

export interface SceneResult {
  /** Où chaque personne s'est projetée : le calque des médaillons s'en sert. */
  screen: Map<string, Projected>;
}

export function drawScene(ctx: CanvasRenderingContext2D, params: SceneParams): SceneResult {
  const { layout, camera, width, height, dpr, palette, highlighted, hasSelection } = params;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const view = makeView(camera, width, height);

  // --- Le ciel, puis la terre ---------------------------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, palette.skyTop);
  sky.addColorStop(1, palette.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  drawGround(ctx, params, view);

  // --- Projection de tout le monde, une seule fois -------------------------
  const screen = new Map<string, Projected>();
  const world = new Map<string, Vec3>();
  for (const person of layout.people.values()) {
    const point = sway(person, params.time);
    world.set(person.id, point);
    const projected = project(view, point);
    if (projected) screen.set(person.id, projected);
  }

  // La brume se mesure sur la distance réellement occupée par la scène : au
  // plus près l'arbre garde tout son contraste, au plus loin il s'efface.
  const far = camera.distance + layout.maxRadius * 1.4;
  const near = Math.max(0.6, camera.distance - layout.maxRadius * 1.4);
  const clarity = (depth: number): number => {
    const t = Math.min(1, Math.max(0, (depth - near) / Math.max(0.001, far - near)));
    return 1 - t * 0.72;
  };

  const sprites: Sprite[] = [];

  // --- Le fût -------------------------------------------------------------
  {
    const foot: Vec3 = { x: 0, y: -0.9, z: 0 };
    const top: Vec3 = { x: 0, y: layout.trunkTop, z: 0 };
    const segment = projectSegment(view, foot, top);
    if (segment) {
      const depth = (segment.a.depth + segment.b.depth) / 2;
      sprites.push({
        depth,
        paint: () => {
          ctx.globalAlpha = clarity(depth);
          ctx.fillStyle = palette.wood;
          limb(
            ctx,
            segment.a,
            segment.b,
            layout.trunkWidth * 1.25,
            layout.trunkWidth,
            palette,
            true,
          );
          ctx.globalAlpha = 1;
        },
      });
    }
  }

  // --- Les départs du fût vers chaque lignée fondatrice --------------------
  for (const person of layout.people.values()) {
    if (person.generation !== 0) continue;
    const point = world.get(person.id);
    if (!point) continue;
    const segment = projectSegment(view, { x: 0, y: layout.trunkTop, z: 0 }, point);
    if (!segment) continue;
    const depth = (segment.a.depth + segment.b.depth) / 2;
    const w0 = layout.trunkWidth * 0.7;
    const w1 = limbWidth(1 + person.weight);
    const faded = hasSelection && !highlighted.has(person.id);
    sprites.push({
      depth,
      paint: () => {
        ctx.globalAlpha = clarity(depth) * (faded ? 0.28 : 1);
        ctx.fillStyle = faded ? palette.dim : palette.wood;
        limb(ctx, segment.a, segment.b, w0, w1, palette, !faded);
        ctx.globalAlpha = 1;
      },
    });
  }

  // --- La ramure ----------------------------------------------------------
  for (const link of layout.links) {
    const a = world.get(link.from);
    const b = world.get(link.to);
    if (!a || !b) continue;
    const segment = projectSegment(view, a, b);
    if (!segment) continue;

    const depth = (segment.a.depth + segment.b.depth) / 2;
    const lit = highlighted.has(link.from) && highlighted.has(link.to);
    const faded = hasSelection && !lit;

    if (link.kind === 'union') {
      sprites.push({
        depth,
        paint: () => {
          ctx.globalAlpha = clarity(depth) * (faded ? 0.22 : 0.85);
          ctx.strokeStyle = lit ? palette.accent : palette.link;
          ctx.lineWidth = Math.max(1, 2.2 * (segment.a.scale / view.focal) * view.focal * 0.012);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(segment.a.x, segment.a.y);
          ctx.lineTo(segment.b.x, segment.b.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        },
      });
      continue;
    }

    sprites.push({
      depth,
      paint: () => {
        ctx.globalAlpha = clarity(depth) * (faded ? 0.26 : 1);
        ctx.fillStyle = faded ? palette.dim : lit ? palette.accent : palette.wood;
        limb(ctx, segment.a, segment.b, link.fromWidth, link.toWidth, palette, !faded);
        ctx.globalAlpha = 1;
      },
    });
  }

  // --- Le feuillage : sur les personnes sans descendance -------------------
  const leafiness = params.detailed ? 1 : 0.55;
  for (const person of layout.people.values()) {
    if (person.weight > 3) continue;
    const projected = screen.get(person.id);
    if (!projected) continue;
    const faded = hasSelection && !highlighted.has(person.id);
    const size = (0.42 + hashN(person.id, 21) * 0.66) * projected.scale;
    if (size < 1.2) continue;
    const roll = hashN(person.id, 22);
    const tone = roll < 0.34 ? palette.leafAlt : roll < 0.78 ? palette.leaf : palette.leafLit;
    const sprite = leafSprite(faded ? palette.dim : tone);
    // Chaque touffe tourne sur elle-même : la même vignette recopiée cent fois
    // dans la même orientation se remarque immédiatement comme un motif.
    const spin = hashN(person.id, 23) * Math.PI * 2;
    sprites.push({
      // Légèrement en avant de la personne : le feuillage enveloppe le
      // médaillon au lieu de disparaître derrière la branche qui le porte.
      depth: projected.depth - 0.01,
      paint: () => {
        ctx.globalAlpha = clarity(projected.depth) * (faded ? 0.14 : 0.5) * leafiness;
        ctx.translate(projected.x, projected.y);
        ctx.rotate(spin);
        ctx.drawImage(sprite, -size, -size, size * 2, size * 2);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 1;
      },
    });
  }

  // --- Les personnes ------------------------------------------------------
  //
  // Elles sont peintes sur le canevas, dans le même tri que le bois, et non
  // posées en éléments de page par-dessus la scène : c'est la seule façon
  // qu'une personne située derrière le tronc passe derrière le tronc. Un
  // calque de médaillons flottant au-dessus de tout aurait ruiné la
  // profondeur à l'instant même où elle est acquise.
  for (const person of layout.people.values()) {
    const projected = screen.get(person.id);
    if (!projected) continue;
    const radius = Math.min(28, 0.13 * projected.scale);
    // De loin, une pastille par personne fait une grappe de billes et masque
    // l'arbre : elles n'apparaissent qu'une fois assez grandes pour dire
    // quelque chose.
    if (radius < 3.4) continue;

    const faded = hasSelection && !highlighted.has(person.id);
    const selected = params.selectedId === person.id;
    const hovered = params.hoveredId === person.id;
    const info = radius > 7 ? params.label(person.id) : null;
    const tint = hashN(person.id, 31);
    const clear = clarity(projected.depth);

    sprites.push({
      // Juste devant sa propre branche, pour que le bois n'entame pas le
      // disque, et juste derrière ce qui est réellement plus près.
      depth: projected.depth - 0.02,
      paint: () => {
        ctx.globalAlpha = clear * (faded ? 0.22 : 1);

        const bubble = ctx.createLinearGradient(
          projected.x - radius,
          projected.y - radius,
          projected.x + radius,
          projected.y + radius,
        );
        bubble.addColorStop(0, `hsl(${210 + tint * 130} 62% ${58 + tint * 10}%)`);
        bubble.addColorStop(1, `hsl(${300 + tint * 90} 58% ${48 + tint * 8}%)`);

        ctx.beginPath();
        ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = faded ? palette.dim : bubble;
        ctx.fill();

        if (selected || hovered) {
          ctx.lineWidth = Math.max(1.5, radius * 0.13);
          ctx.strokeStyle = palette.accent;
          ctx.stroke();
        } else if (radius > 4) {
          ctx.lineWidth = Math.max(0.8, radius * 0.07);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
          ctx.stroke();
        }

        if (info && !faded) {
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `600 ${radius * 0.82}px system-ui, -apple-system, sans-serif`;
          ctx.fillText(info.initials, projected.x, projected.y);

          if (radius > 15) {
            ctx.font = `600 ${Math.min(15, radius * 0.52)}px system-ui, -apple-system, sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillStyle = palette.leafLit;
            ctx.fillText(info.name, projected.x, projected.y + radius * 1.24);
          }
        }

        ctx.globalAlpha = 1;
      },
    });
  }

  // Du fond vers l'avant.
  sprites.sort((a, b) => b.depth - a.depth);
  for (const sprite of sprites) sprite.paint();

  return { screen };
}

/**
 * Une branche, en tronc de cône vu de face.
 *
 * Le quadrilatère seul laisse une encoche à chaque jonction : deux branches
 * d'orientations différentes ne partagent qu'un point, et l'angle entre elles
 * s'ouvre. Un disque posé à chaque extrémité comble exactement cet angle, quel
 * qu'il soit — c'est la façon la plus simple de garantir qu'aucune branche ne
 * se détache d'une autre, et elle ne peut pas échouer puisqu'elle ne dépend
 * d'aucune géométrie.
 */
function limb(
  ctx: CanvasRenderingContext2D,
  a: Projected,
  b: Projected,
  worldFrom: number,
  worldTo: number,
  palette: ScenePalette,
  shade: boolean,
): void {
  const wa = Math.max(0.7, worldFrom * a.scale);
  const wb = Math.max(0.6, worldTo * b.scale);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return;

  const nx = -dy / length;
  const ny = dx / length;

  ctx.beginPath();
  ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
  ctx.lineTo(b.x + nx * wb, b.y + ny * wb);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.lineTo(a.x - nx * wa, a.y - ny * wa);
  ctx.closePath();
  // Les deux articulations, dans le même chemin : la règle du non-zéro les
  // fusionne avec le fût au lieu de les y superposer.
  ctx.moveTo(a.x + wa, a.y);
  ctx.arc(a.x, a.y, wa, 0, Math.PI * 2);
  ctx.moveTo(b.x + wb, b.y);
  ctx.arc(b.x, b.y, wb, 0, Math.PI * 2);
  ctx.fill();

  // Le modelé : un filet clair du côté de la lumière. Il ne vaut la peine que
  // lorsque la branche est assez large pour qu'on le distingue.
  if (!shade || Math.min(wa, wb) < 2.2) return;
  const inset = 0.42;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * wa * 0.86, a.y + ny * wa * 0.86);
  ctx.lineTo(b.x + nx * wb * 0.86, b.y + ny * wb * 0.86);
  ctx.lineTo(b.x + nx * wb * inset, b.y + ny * wb * inset);
  ctx.lineTo(a.x + nx * wa * inset, a.y + ny * wa * inset);
  ctx.closePath();
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = previous * 0.5;
  ctx.fillStyle = palette.woodLight;
  ctx.fill();
  ctx.globalAlpha = previous;
}

/**
 * Le sol.
 *
 * Un disque, projeté par son contour. Sans lui l'arbre flotte dans un vide
 * uniforme et l'on perd toute échelle : c'est l'horizon qui dit à quelle
 * hauteur on se trouve, et c'est l'ombre au pied qui dit que l'arbre est posé
 * quelque part.
 */
function drawGround(
  ctx: CanvasRenderingContext2D,
  params: SceneParams,
  view: ReturnType<typeof makeView>,
): void {
  const { palette, layout } = params;
  const radius = Math.max(layout.maxRadius * 3.4, 18);
  const steps = 72;

  const points: Projected[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const projected = project(view, {
      x: Math.cos(angle) * radius,
      y: 0,
      z: Math.sin(angle) * radius,
    });
    if (projected) points.push(projected);
  }
  if (points.length < 3) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();

  const centre = project(view, AXIS);
  if (centre) {
    // Le sol s'efface avant son bord.
    //
    // Rempli d'un aplat, le disque montre son contour : une ellipse parfaite
    // en travers du ciel, qui dit « plateau posé sur une table » et non
    // « terrain qui se perd au loin ». Le dégradé le fait disparaître dans
    // l'air bien avant d'atteindre sa limite, et l'horizon redevient un
    // horizon.
    const wash = ctx.createRadialGradient(
      centre.x,
      centre.y,
      0,
      centre.x,
      centre.y,
      Math.max(50, radius * centre.scale * 0.22),
    );
    wash.addColorStop(0, palette.ground);
    wash.addColorStop(0.4, palette.groundEdge);
    wash.addColorStop(1, 'transparent');
    ctx.fillStyle = wash;
    // Une terre pleine remplit le bas du cadre d'un aplat brun qui pèse plus
    // que l'arbre. Elle n'est là que pour poser le pied et donner l'échelle.
    ctx.globalAlpha = 0.55;
  } else {
    ctx.fillStyle = palette.groundEdge;
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  // L'ombre portée du houppier, au pied.
  if (!centre) return;
  const shadow = ctx.createRadialGradient(
    centre.x,
    centre.y,
    0,
    centre.x,
    centre.y,
    Math.max(24, layout.maxRadius * 0.9 * centre.scale),
  );
  shadow.addColorStop(0, palette.haze);
  shadow.addColorStop(1, 'transparent');
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = shadow;
  ctx.fill();
  ctx.globalAlpha = 1;
}
