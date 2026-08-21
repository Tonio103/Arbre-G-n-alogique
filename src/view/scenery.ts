import type { TrunkLayout } from '@/domain/layout';
import { ROW_HEIGHT } from './metrics';
import { hashN, jitter } from './organic';

/**
 * Le décor au pied de l'arbre.
 *
 * Un arbre posé sur du vide reste un schéma : rien ne dit où il pousse, ni à
 * quelle échelle. Quelques éléments suffisent à le planter — de la terre, des
 * pierres, de l'herbe, des fleurs — à condition qu'ils obéissent aux mêmes
 * règles que la ramure : dessinés au canevas, déterministes, et proportionnés à
 * la distance d'observation.
 *
 * Tout ce module est volontairement pauvre en formes. Le décor doit se
 * remarquer sans se regarder : c'est l'arbre qu'on vient voir.
 */

export interface SceneryPalette {
  /** Terre de la clairière. */
  ground: string;
  /** Ligne de surface, plus dense : ce qui fait lire un sol. */
  soil: string;
  /** Ombre portée au pied du tronc. */
  groundShade: string;
  /** Face éclairée des pierres. */
  stone: string;
  /** Face à l'ombre des pierres. */
  stoneShade: string;
  grass: string;
  grassAlt: string;
  /** Cœur des fleurs. */
  bloom: string;
  bloomAlt: string;
}

export interface SceneryParams {
  trunk: TrunkLayout;
  palette: SceneryPalette;
  /** Échelle courante : le décor s'allège quand on s'éloigne. */
  scale: number;
  /** Phase de la brise, en secondes. */
  time: number;
  /** Étendue horizontale visible, pour ne semer que ce qui sera vu. */
  left: number;
  right: number;
}

/** Hauteur du sol : la ligne sur laquelle tout le décor se pose. */
export const groundLevel = (trunk: TrunkLayout): number => trunk.baseY - ROW_HEIGHT * 0.5;

/**
 * La clairière.
 *
 * Une ellipse en dégradé, pas une bande : un rectangle, si large soit-il, finit
 * toujours par montrer ses deux arêtes verticales au milieu du vide, alors
 * qu'un dégradé radial s'éteint dans toutes les directions à la fois.
 */
export function drawGround(ctx: CanvasRenderingContext2D, params: SceneryParams): void {
  const { trunk, palette } = params;
  if (trunk.roots.length === 0) return;

  const y = groundLevel(trunk);
  const reach = Math.max(params.right - params.left, ROW_HEIGHT * 8) * 0.62;
  const flatten = (ROW_HEIGHT * 1.5) / reach;

  const paintEllipse = (radius: number, fill: string | CanvasGradient): void => {
    ctx.save();
    ctx.translate(trunk.x, y);
    ctx.scale(1, flatten);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  };

  const soil = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
  soil.addColorStop(0, palette.ground);
  soil.addColorStop(0.55, palette.ground);
  soil.addColorStop(1, 'transparent');
  paintEllipse(reach, soil);

  // La ligne de terre.
  //
  // La clairière seule reste une tache diffuse qu'on ne lit pas comme un sol :
  // il manque la surface. Une bande étroite et nettement plus dense, juste sous
  // la ligne, suffit à poser l'horizon — c'est elle qui dit « ici commence la
  // terre » même quand tout le reste est réduit à quelques pixels.
  const crust = ctx.createLinearGradient(0, y - ROW_HEIGHT * 0.06, 0, y + ROW_HEIGHT * 0.5);
  crust.addColorStop(0, 'transparent');
  crust.addColorStop(0.18, palette.soil);
  crust.addColorStop(1, 'transparent');
  ctx.fillStyle = crust;
  ctx.fillRect(
    trunk.x - reach,
    y - ROW_HEIGHT * 0.06,
    reach * 2,
    ROW_HEIGHT * 0.56,
  );

  const shadowReach = Math.max(trunk.width * 7, ROW_HEIGHT);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowReach);
  shade.addColorStop(0, palette.groundShade);
  shade.addColorStop(1, 'transparent');
  paintEllipse(shadowReach, shade);
}

/**
 * Sème le décor le long du sol.
 *
 * Les positions viennent d'une grille régulière que le hachage vient troubler :
 * une distribution purement aléatoire fait des paquets et des trous, une grille
 * pure fait un motif. Le pas de la grille est indexé sur la position, donc
 * stable quel que soit le cadrage — un galet ne se déplace jamais parce qu'on
 * a fait défiler la vue.
 */
function* scatter(
  left: number,
  right: number,
  step: number,
  seed: string,
): Generator<{ x: number; index: number; roll: number }> {
  const from = Math.floor(left / step);
  const to = Math.ceil(right / step);
  for (let i = from; i <= to; i += 1) {
    const roll = hashN(seed, i);
    yield { x: i * step + jitter(seed, i + 9973, step * 0.42), index: i, roll };
  }
}

/**
 * Pierres.
 *
 * Deux arcs par galet : une masse et sa face éclairée. C'est le minimum pour
 * qu'une forme se lise comme un volume posé au sol plutôt qu'une tache.
 */
export function drawStones(ctx: CanvasRenderingContext2D, params: SceneryParams): void {
  const { trunk, palette, scale } = params;
  const y = groundLevel(trunk);
  const size = Math.max(9, Math.min(70, 15 / Math.max(scale, 0.03)));
  const step = size * 22;

  const bodies: Array<{ x: number; y: number; rx: number; ry: number }> = [];

  for (const { x, index, roll } of scatter(params.left, params.right, step, 'pierre')) {
    // Deux tiers seulement des emplacements portent une pierre : semer partout
    // ferait un alignement de galets, ce qu'aucun sol n'a jamais montré.
    if (roll > 0.62) continue;
    const rx = size * (0.7 + hashN('pierre-r', index) * 0.85);
    const ry = rx * (0.42 + hashN('pierre-h', index) * 0.24);
    bodies.push({ x, y: y + jitter('pierre-y', index, ROW_HEIGHT * 0.05), rx, ry });
  }

  if (bodies.length === 0) return;

  ctx.beginPath();
  for (const s of bodies) {
    ctx.moveTo(s.x + s.rx, s.y);
    ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.stoneShade;
  ctx.fill();

  // Face éclairée : une calotte décalée vers la source de lumière.
  ctx.beginPath();
  for (const s of bodies) {
    ctx.moveTo(s.x + s.rx * 0.62, s.y - s.ry * 0.28);
    ctx.ellipse(s.x - s.rx * 0.12, s.y - s.ry * 0.28, s.rx * 0.74, s.ry * 0.55, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.stone;
  ctx.fill();
}

/**
 * Herbe et fleurs.
 *
 * Les brins s'inclinent tous ensemble sous la brise, avec un décalage de phase
 * qui dépend de leur position : un champ où tout oscille à l'unisson se voit
 * immédiatement comme une animation, alors qu'une onde qui traverse se lit
 * comme du vent.
 */
export function drawUndergrowth(ctx: CanvasRenderingContext2D, params: SceneryParams): void {
  const { trunk, palette, scale, time } = params;
  const y = groundLevel(trunk);
  const size = Math.max(11, Math.min(85, 17 / Math.max(scale, 0.03)));
  const step = size * 3.4;

  const near: number[] = [];
  const far: number[] = [];
  const blooms: Array<{ x: number; y: number; r: number; warm: boolean }> = [];

  for (const { x, index, roll } of scatter(params.left, params.right, step, 'herbe')) {
    if (roll > 0.82) continue;

    // L'onde parcourt le sol : la phase dépend de l'abscisse, si bien que le
    // vent traverse la scène au lieu de la secouer d'un bloc.
    const phase = time * 1.1 + x * 0.0016;
    const sway = Math.sin(phase) * size * 0.24;
    const height = size * (0.75 + hashN('herbe-h', index) * 0.8);
    const base = y + jitter('herbe-y', index, ROW_HEIGHT * 0.04);

    const blades = 3 + Math.floor(hashN('herbe-n', index) * 3);
    for (let k = 0; k < blades; k += 1) {
      const bx = x + jitter(`herbe-x${index}`, k, size * 1.1);
      const bh = height * (0.6 + hashN(`herbe-k${index}`, k) * 0.7);
      const tip = bx + sway * (0.6 + hashN(`herbe-s${index}`, k) * 0.8);
      (k % 2 === 0 ? near : far).push(bx, base, tip, base - bh);
    }

    // Une fleur sur cinq touffes : au-delà, le sol devient un parterre.
    if (roll < 0.2) {
      const fx = x + jitter('fleur-x', index, size * 0.9);
      const fh = height * (0.9 + hashN('fleur-h', index) * 0.5);
      blooms.push({
        x: fx + sway * 0.9,
        y: base - fh,
        r: size * (0.15 + hashN('fleur-r', index) * 0.1),
        warm: hashN('fleur-c', index) < 0.55,
      });
    }
  }

  const paintBlades = (list: number[], color: string, width: number): void => {
    if (list.length === 0) return;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 4) {
      ctx.moveTo(list[i], list[i + 1]);
      // Un brin d'herbe n'est pas droit : il s'arque, et c'est cette courbure
      // qui rend l'inclinaison lisible.
      ctx.quadraticCurveTo(
        list[i] + (list[i + 2] - list[i]) * 0.3,
        (list[i + 1] + list[i + 3]) / 2,
        list[i + 2],
        list[i + 3],
      );
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  paintBlades(far, palette.grassAlt, Math.max(0.8, size * 0.075));
  paintBlades(near, palette.grass, Math.max(0.9, size * 0.09));

  if (blooms.length === 0) return;

  // Les tiges sont déjà dans l'herbe : seule la corolle se dessine.
  for (const warm of [true, false]) {
    const group = blooms.filter((b) => b.warm === warm);
    if (group.length === 0) continue;
    ctx.beginPath();
    for (const b of group) {
      ctx.moveTo(b.x + b.r, b.y);
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = warm ? palette.bloom : palette.bloomAlt;
    ctx.fill();
  }
}
