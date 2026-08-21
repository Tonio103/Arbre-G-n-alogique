import type { TrunkLayout } from '@/domain/layout';
import { ROW_HEIGHT } from './metrics';
import { fade } from './colors';
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
  /** Terre en profondeur, sous la surface. */
  soilDeep: string;
  /** Cailloux et gravier enfouis. */
  soilGrain: string;
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
  /** Cœur de la corolle, vu de près. */
  bloomHeart: string;
  /** Tache de lumière filtrée par le feuillage. */
  sunDapple: string;
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
  /** Bas du cadre : la terre descend au moins jusque-là. */
  bottom: number;
}

/** Altitude de référence du sol, avant le relief. */
export const groundLevel = (trunk: TrunkLayout): number => trunk.baseY - ROW_HEIGHT * 0.5;

/** Pas du relief : la distance entre deux crêtes. */
const RELIEF_STEP = ROW_HEIGHT * 1.15;
/** Amplitude du relief, de part et d'autre de la ligne de référence. */
const RELIEF = ROW_HEIGHT * 0.075;

/**
 * Le relief du terrain.
 *
 * Un sol parfaitement horizontal est une étagère : il n'existe nulle part, et
 * l'œil le reconnaît immédiatement comme une ligne tracée. Quelques ondulations
 * très lentes suffisent à en faire un terrain.
 *
 * Les hauteurs sont tirées du hachage tous les `RELIEF_STEP`, puis interpolées
 * en cosinus — une interpolation linéaire laisserait des arêtes vives aux
 * points de contrôle, et le sol ressemblerait à une chaîne de montagnes en
 * papier plié.
 *
 * L'ondulation s'efface près du tronc : l'arbre a été planté à une altitude
 * précise, et un terrain qui monterait sous lui l'enterrerait à moitié.
 */
export function relief(x: number, trunkX: number): number {
  const t = x / RELIEF_STEP;
  const i = Math.floor(t);
  const f = t - i;
  const a = hashN('relief', i) - 0.5;
  const b = hashN('relief', i + 1) - 0.5;
  const smooth = (1 - Math.cos(f * Math.PI)) / 2;
  const wave = a + (b - a) * smooth;

  const flat = Math.min(1, Math.abs(x - trunkX) / (ROW_HEIGHT * 2.4));
  return wave * 2 * RELIEF * flat;
}

/** Altitude du sol à une abscisse donnée : tout le décor s'y pose. */
export const terrainY = (trunk: TrunkLayout, x: number): number =>
  groundLevel(trunk) + relief(x, trunk.x);

/**
 * La terre.
 *
 * Il ne s'agit plus d'une bande posée sous l'arbre mais de la matière du
 * paysage : au-dessus de la ligne, l'air ; en dessous, la terre, qui s'assombrit
 * puis se perd en profondeur. C'est ce contraste franc — deux milieux, une
 * frontière — qui fait qu'on lit un sol plutôt qu'un aplat, et qui donne enfin
 * une raison d'être aux racines.
 */
export function drawGround(ctx: CanvasRenderingContext2D, params: SceneryParams): void {
  const { trunk, palette } = params;
  if (trunk.roots.length === 0) return;

  const y = groundLevel(trunk);
  const left = params.left;
  const right = params.right;
  const reach = Math.max(right - left, ROW_HEIGHT * 8) * 0.62;
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

  // La silhouette du terrain, suivie pas à pas.
  //
  // Le pas est calé sur le relief lui-même, pas sur l'écran : le sol garde
  // exactement la même forme à tous les zooms, et deux images successives ne
  // peuvent pas le faire onduler.
  const step = RELIEF_STEP / 6;
  const from = Math.floor(left / step) * step;
  const to = Math.ceil(right / step) * step;
  // La terre descend jusqu'au bas du cadre, toujours. À profondeur fixe, elle
  // s'arrêtait en pleine page dès qu'on prenait du recul : sous l'horizon
  // s'ouvrait alors un vide de la couleur du ciel, ce qui n'est un paysage
  // dans aucune direction.
  const depth = Math.max(ROW_HEIGHT * 3.4, (params.bottom - y) * 1.08);

  const traceSurface = (): void => {
    ctx.beginPath();
    ctx.moveTo(from, terrainY(trunk, from));
    for (let x = from + step; x <= to; x += step) ctx.lineTo(x, terrainY(trunk, x));
  };

  // La masse de terre, du sol jusqu'à la profondeur où elle se perd.
  // Elle ne s'éteint pas en profondeur : sous l'horizon, il y a de la terre
  // jusqu'en bas du cadre. Le dégradé ne sert qu'à l'assombrir en descendant,
  // comme une coupe de sol — un fond de ciel qui reparaissait sous la terre
  // était le plus sûr moyen de défaire le paysage.
  const earth = ctx.createLinearGradient(0, y, 0, y + depth);
  earth.addColorStop(0, palette.soil);
  earth.addColorStop(0.35, palette.soilDeep);
  earth.addColorStop(1, palette.soilDeep);
  traceSurface();
  ctx.lineTo(to, y + depth);
  ctx.lineTo(from, y + depth);
  ctx.closePath();
  ctx.fillStyle = earth;
  ctx.fill();

  // L'herbe rase de la clairière, posée par-dessus la terre : c'est elle qui
  // donne sa couleur au sol autour de l'arbre, et son extinction radiale évite
  // la bande verte d'un horizon à horizon.
  const meadow = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
  meadow.addColorStop(0, palette.ground);
  meadow.addColorStop(0.55, palette.ground);
  meadow.addColorStop(1, fade(palette.ground));
  //
  // Elle ne mord que sur les premières dizaines d'unités sous la surface : au
  // delà, ce n'est plus de l'herbe, c'est de la terre, et une teinte verte
  // étalée sur toute la profondeur donnait un sol de vase.
  ctx.save();
  traceSurface();
  ctx.lineTo(to, y + ROW_HEIGHT * 0.1);
  ctx.lineTo(from, y + ROW_HEIGHT * 0.1);
  ctx.closePath();
  ctx.clip();
  paintEllipse(reach, meadow);
  ctx.restore();

  // L'ombre de l'arbre au sol.
  ctx.save();
  traceSurface();
  ctx.lineTo(to, y + ROW_HEIGHT * 0.22);
  ctx.lineTo(from, y + ROW_HEIGHT * 0.22);
  ctx.closePath();
  ctx.clip();
  const shadowReach = Math.max(trunk.width * 7, ROW_HEIGHT);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowReach);
  shade.addColorStop(0, palette.groundShade);
  shade.addColorStop(1, fade(palette.groundShade));
  paintEllipse(shadowReach, shade);
  ctx.restore();

  // Le trait de surface. Fin, plus dense que la terre : c'est lui qui tranche
  // entre les deux milieux, et il reste lisible quand tout le reste s'est réduit
  // à quelques pixels.
  traceSurface();
  ctx.strokeStyle = palette.soil;
  ctx.lineWidth = Math.max(ROW_HEIGHT * 0.008, 1.2 / Math.max(params.scale, 0.004));
  ctx.stroke();
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
  const size = Math.max(9, Math.min(70, 15 / Math.max(scale, 0.03)));
  const step = size * 22;

  const bodies: Array<{ x: number; y: number; rx: number; ry: number }> = [];

  for (const { x, index, roll } of scatter(params.left, params.right, step, 'pierre')) {
    // Deux tiers seulement des emplacements portent une pierre : semer partout
    // ferait un alignement de galets, ce qu'aucun sol n'a jamais montré.
    if (roll > 0.62) continue;
    const rx = size * (0.7 + hashN('pierre-r', index) * 0.85);
    const ry = rx * (0.42 + hashN('pierre-h', index) * 0.24);
    // Posée sur le terrain, pas sur la ligne de référence : une pierre qui
    // flotterait au-dessus d'un creux se verrait tout de suite.
    bodies.push({
      x,
      y: terrainY(trunk, x) + jitter('pierre-y', index, ROW_HEIGHT * 0.035),
      rx,
      ry,
    });
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
 * Le grain de la terre.
 *
 * Sous l'horizon, la masse est uniforme : une couleur, un dégradé, rien à quoi
 * l'œil puisse s'accrocher. Quelques cailloux enfouis et un peu de gravier
 * suffisent à lui donner de la matière — on ne les regarde pas, on les voit.
 */
export function drawSoilGrain(ctx: CanvasRenderingContext2D, params: SceneryParams): void {
  const { trunk, palette, scale } = params;
  if (scale < 0.04) return;

  const size = Math.max(4, Math.min(26, 6 / Math.max(scale, 0.03)));
  const step = size * 9;
  const top = groundLevel(trunk);
  const depth = Math.min(ROW_HEIGHT * 2.2, (params.bottom - top) * 0.9);
  if (depth <= 0) return;

  ctx.beginPath();
  let count = 0;
  for (const { x, index, roll } of scatter(params.left, params.right, step, 'grain')) {
    if (roll > 0.5) continue;
    // Plusieurs grains par colonne : une seule rangée dessinerait un liseré.
    const rows = 3 + Math.floor(hashN('grain-n', index) * 4);
    for (let k = 0; k < rows; k += 1) {
      const t = (k + hashN(`grain-t${index}`, k)) / rows;
      const y = terrainY(trunk, x) + 40 + t * t * depth;
      if (y > params.bottom) break;
      const rx = size * (0.35 + hashN(`grain-r${index}`, k) * 0.9);
      ctx.moveTo(x + rx, y);
      ctx.ellipse(
        x + jitter(`grain-x${index}`, k, step * 0.45),
        y,
        rx,
        rx * (0.4 + hashN(`grain-h${index}`, k) * 0.4),
        hashN(`grain-a${index}`, k) * Math.PI,
        0,
        Math.PI * 2,
      );
      count += 1;
      if (count > 700) break;
    }
    if (count > 700) break;
  }
  ctx.fillStyle = palette.soilGrain;
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
  const size = Math.max(11, Math.min(85, 17 / Math.max(scale, 0.03)));
  // Un pas serré : à trois largeurs de touffe, l'herbe n'est plus un tapis mais
  // une rangée de brins plantés un par un.
  const step = size * 1.9;

  const near: number[] = [];
  const far: number[] = [];
  const blooms: Array<{ x: number; y: number; r: number; warm: boolean; index: number }> = [];

  for (const { x, index, roll } of scatter(params.left, params.right, step, 'herbe')) {
    if (roll > 0.82) continue;

    // L'onde parcourt le sol : la phase dépend de l'abscisse, si bien que le
    // vent traverse la scène au lieu de la secouer d'un bloc.
    const phase = time * 1.1 + x * 0.0016;
    const sway = Math.sin(phase) * size * 0.24;
    const height = size * (0.75 + hashN('herbe-h', index) * 0.8);
    const base = terrainY(trunk, x) + jitter('herbe-y', index, ROW_HEIGHT * 0.03);

    const blades = 4 + Math.floor(hashN('herbe-n', index) * 4);
    for (let k = 0; k < blades; k += 1) {
      const bx = x + jitter(`herbe-x${index}`, k, size * 1.1);
      const bh = height * (0.6 + hashN(`herbe-k${index}`, k) * 0.7);
      const tip = bx + sway * (0.6 + hashN(`herbe-s${index}`, k) * 0.8);
      (k % 2 === 0 ? near : far).push(bx, base, tip, base - bh);
    }

    // Une fleur sur trois touffes environ : assez pour qu'on en voie partout où
    // le regard se pose, pas assez pour faire un parterre.
    if (roll < 0.32) {
      const fx = x + jitter('fleur-x', index, size * 0.9);
      const fh = height * (0.9 + hashN('fleur-h', index) * 0.5);
      blooms.push({
        x: fx + sway * 0.9,
        y: base - fh,
        r: size * (0.19 + hashN('fleur-r', index) * 0.14),
        warm: hashN('fleur-c', index) < 0.55,
        index,
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
  //
  // De près, elle s'ouvre en pétales ; de loin, un disque suffit — cinq pétales
  // de deux pixels ne font qu'une tache sale, et coûtent cinq fois le prix.
  const petals = size > 26;

  for (const warm of [true, false]) {
    const group = blooms.filter((b) => b.warm === warm);
    if (group.length === 0) continue;
    ctx.beginPath();
    for (const b of group) {
      if (!petals) {
        ctx.moveTo(b.x + b.r, b.y);
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        continue;
      }
      const turn = hashN('fleur-t', b.index) * Math.PI;
      for (let k = 0; k < 5; k += 1) {
        const angle = turn + (k / 5) * Math.PI * 2;
        const px = b.x + Math.cos(angle) * b.r * 0.78;
        const py = b.y + Math.sin(angle) * b.r * 0.78;
        ctx.moveTo(px + b.r * 0.58, py);
        ctx.arc(px, py, b.r * 0.58, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = warm ? palette.bloom : palette.bloomAlt;
    ctx.fill();
  }

  // Le cœur, d'une autre teinte : sans lui, une corolle à cinq pétales reste
  // une rosace.
  if (!petals) return;
  ctx.beginPath();
  for (const b of blooms) {
    ctx.moveTo(b.x + b.r * 0.42, b.y);
    ctx.arc(b.x, b.y, b.r * 0.42, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.bloomHeart;
  ctx.fill();
}

/**
 * Les taches de lumière au sol.
 *
 * Sous un arbre, le soleil ne pose pas une nappe uniforme : le feuillage le
 * découpe en flaques claires qui se déplacent au gré du vent dans les
 * branches. C'est le détail qui, plus que tout autre, distingue un sol éclairé
 * d'un aplat de couleur — et il bouge tout seul, ce qui en fait le meilleur
 * signe de vie qu'on puisse poser au pied de l'arbre.
 *
 * Elles dérivent lentement et respirent : le feuillage qui les découpe bouge
 * lui-même, donc leur contour ne peut pas être fixe.
 */
export function drawDapples(ctx: CanvasRenderingContext2D, params: SceneryParams): void {
  const { trunk, palette, scale, time } = params;
  if (scale < 0.02) return;

  const size = Math.max(30, Math.min(340, 60 / Math.max(scale, 0.02)));
  const step = size * 4.6;

  ctx.save();
  for (const { x, index, roll } of scatter(params.left, params.right, step, 'tache')) {
    if (roll > 0.55) continue;

    // Chaque flaque suit sa propre dérive, très lente : à l'unisson, elles
    // formeraient une nappe qui glisse, ce qui ne ressemble à rien.
    const wander = Math.sin(time * 0.16 + index * 0.9) * size * 0.75;
    const breath = 0.72 + Math.sin(time * 0.3 + index * 1.7) * 0.28;
    const rx = size * (0.7 + hashN('tache-r', index) * 0.9) * breath;
    const ry = rx * (0.26 + hashN('tache-h', index) * 0.16);
    const cy = terrainY(trunk, x + wander) - jitter('tache-y', index, ROW_HEIGHT * 0.05);

    const glow = ctx.createRadialGradient(x + wander, cy, 0, x + wander, cy, rx);
    glow.addColorStop(0, palette.sunDapple);
    glow.addColorStop(0.5, palette.sunDapple);
    glow.addColorStop(1, fade(palette.sunDapple));

    ctx.save();
    ctx.translate(x + wander, cy);
    ctx.scale(1, ry / rx);
    ctx.translate(-(x + wander), -cy);
    ctx.beginPath();
    ctx.arc(x + wander, cy, rx, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
