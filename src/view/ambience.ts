import { fade } from './colors';
import { hashN, jitter } from './organic';

/**
 * Ce qui bouge dans l'air.
 *
 * Le décor au sol dit où l'arbre pousse ; il ne dit pas que la scène est
 * vivante. Un sol, un tronc et un feuillage peuvent parfaitement être une
 * photographie. Ce qui trahit le vivant, c'est ce qui traverse : une graine qui
 * monte dans un rai de lumière, un pétale qui tombe, un oiseau qui passe. Trois
 * choses insignifiantes qu'on ne regarde jamais directement, et dont l'absence
 * se remarque immédiatement.
 *
 * Comme partout ailleurs dans le rendu, rien n'est stocké et rien n'est
 * aléatoire. Chaque élément est une fonction pure de sa position dans une
 * grille et du temps écoulé : la scène peut être repeinte à n'importe quel
 * instant, dans n'importe quel ordre, elle donnera toujours la même image. Un
 * système de particules classique — un tableau qu'on fait avancer image par
 * image — aurait imposé un état à maintenir, et surtout se serait décorrélé du
 * décor dès la première image sautée.
 */

export interface AmbiencePalette {
  /** Poussière lumineuse en suspension. */
  mote: string;
  /** Pétale, teinte chaude. */
  petal: string;
  /** Pétale, seconde teinte. */
  petalAlt: string;
  /** Silhouette d'oiseau, très discrète. */
  bird: string;
  /** Nuage, face éclairée. */
  cloud: string;
  /** Dessous du nuage, plus froid : ce qui lui donne du volume. */
  cloudShade: string;
}

export interface AmbienceParams {
  palette: AmbiencePalette;
  scale: number;
  /** Phase de la brise, en secondes. */
  time: number;
  /** Cadre visible, en unités de monde. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Hauteur du sol : ce qui tombe s'y arrête. */
  ground: number;
  /** Sommet de la couronne : au-dessus, c'est le ciel. */
  canopyTop: number;
  /** Axe du tronc, autour duquel la couronne est centrée. */
  trunkX: number;
  /** Demi-largeur de la couronne : les pétales n'en sortent pas. */
  canopyHalfWidth: number;
  /**
   * Le cadre réellement affiché, sans la marge de débordement.
   *
   * Les champs de particules sèment un peu au-delà de l'écran, pour qu'une
   * poussière entre par le bord au lieu d'apparaître dedans. Ce qui doit être
   * vu à coup sûr — un oiseau — se place au contraire dans le cadre exact.
   */
  viewTop: number;
  viewHeight: number;
}

interface Grain {
  x: number;
  y: number;
  /** Avancement dans le cycle, de 0 à 1. */
  phase: number;
  /** Valeur stable propre à la cellule, pour varier tailles et teintes. */
  roll: number;
  /** Identifiant de cellule, pour tirer d'autres valeurs. */
  index: number;
}

/** Au-delà, on ne sème plus : la scène est trop dézoomée pour qu'on distingue quoi que ce soit. */
const MAX_CELLS = 900;

/**
 * Sème un champ d'éléments dérivants sur le cadre visible.
 *
 * Le principe : une grille régulière, une position tirée du hachage dans chaque
 * cellule, et un déplacement qui dépend du temps. Le déplacement est cyclique —
 * au bout d'une période, l'élément revient à son point de départ. Ce retour
 * serait un saut visible, d'où l'enveloppe d'opacité en sinus : l'élément naît
 * transparent, vit, et s'éteint avant de se replacer. Personne ne voit jamais
 * la couture.
 *
 * La période est propre à chaque cellule, sinon tout le champ battrait à
 * l'unisson — ce qui se lit instantanément comme une boucle.
 */
function* field(
  params: AmbienceParams,
  seed: string,
  cell: number,
  driftX: number,
  driftY: number,
  period: number,
): Generator<Grain> {
  const margin = Math.max(Math.abs(driftX), Math.abs(driftY)) + cell;
  const i0 = Math.floor((params.left - margin) / cell);
  const i1 = Math.ceil((params.right + margin) / cell);
  const j0 = Math.floor((params.top - margin) / cell);
  const j1 = Math.ceil((params.bottom + margin) / cell);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_CELLS) return;

  for (let i = i0; i <= i1; i += 1) {
    for (let j = j0; j <= j1; j += 1) {
      const index = i * 7919 + j;
      const roll = hashN(seed, index);
      // Période et départ propres à la cellule : sans cela, toutes les graines
      // naîtraient et mourraient en même temps.
      const span = period * (0.7 + hashN(`${seed}!p`, index) * 0.75);
      const phase = (params.time / span + hashN(`${seed}!s`, index)) % 1;
      yield {
        x: i * cell + hashN(`${seed}!x`, index) * cell + driftX * (phase - 0.5),
        y: j * cell + hashN(`${seed}!y`, index) * cell + driftY * (phase - 0.5),
        phase,
        roll,
        index,
      };
    }
  }
}

/** Opacité en cloche : naissance et extinction en fondu, plein éclat au milieu. */
const envelope = (phase: number): number => Math.sin(Math.PI * phase);

/**
 * Poussière lumineuse.
 *
 * Des graines, du pollen, de la lumière accrochée à rien — peu importe le nom :
 * c'est ce qui donne son épaisseur à l'air. Elles montent lentement en dérivant,
 * comme tout ce qui est assez léger pour que la moindre chaleur le soulève.
 *
 * La taille de la grille est indexée sur l'échelle, donc leur densité à l'écran
 * ne change pas avec le zoom : de près on traverse un rai de poussière, de loin
 * on voit le même voile.
 */
export function drawMotes(ctx: CanvasRenderingContext2D, params: AmbienceParams): void {
  const { scale, palette } = params;
  const px = 1 / Math.max(scale, 0.002);
  const cell = 118 * px;

  interface Speck {
    x: number;
    y: number;
    radius: number;
    alpha: number;
  }
  const specks: Speck[] = [];

  for (const grain of field(params, 'poussiere', cell, cell * 1.15, -cell * 0.95, 13)) {
    // La moitié des emplacements reste vide : une grille pleine, si troublée
    // soit-elle, finit toujours par montrer ses rangées.
    if (grain.roll > 0.5) continue;
    if (grain.y > params.ground) continue;

    // Le flottement latéral. Une graine qui monte en ligne droite est une bulle
    // dans un tube ; c'est cette hésitation qui la met dans l'air.
    const wobble = Math.sin(params.time * 0.8 + grain.index * 0.7) * cell * 0.14;
    const alpha = envelope(grain.phase) * (0.4 + grain.roll * 1.2);
    if (alpha < 0.05) continue;

    specks.push({
      x: grain.x + wobble,
      y: grain.y,
      radius: px * (1 + hashN('poussiere!r', grain.index) * 1.9),
      alpha: Math.min(1, alpha),
    });
    if (specks.length > 200) break;
  }

  if (specks.length === 0) return;

  // Deux passes : un halo large et très pâle, puis le cœur.
  //
  // Une poussière n'est pas un point : c'est un peu de lumière accrochée à
  // presque rien, et ce qui la rend visible sur un fond clair, c'est cette
  // auréole. Un disque net à la même opacité se lirait comme une tache sur
  // l'écran — un pixel mort, pas une graine dans l'air.
  ctx.fillStyle = palette.mote;
  for (const pass of [0, 1]) {
    ctx.beginPath();
    for (const speck of specks) {
      const radius = pass === 0 ? speck.radius * 2.6 : speck.radius;
      ctx.moveTo(speck.x + radius, speck.y);
      ctx.arc(speck.x, speck.y, radius, 0, Math.PI * 2);
    }
    ctx.globalAlpha = pass === 0 ? 0.22 : 0.85;
    ctx.fill();
  }

  // Les plus lumineuses reprennent leur opacité propre : sans elles, tout le
  // champ scintille au même éclat et se voit comme une trame.
  ctx.beginPath();
  for (const speck of specks) {
    if (speck.alpha < 0.75) continue;
    ctx.moveTo(speck.x + speck.radius, speck.y);
    ctx.arc(speck.x, speck.y, speck.radius, 0, Math.PI * 2);
  }
  ctx.globalAlpha = 1;
  ctx.fill();

  ctx.globalAlpha = 1;
}

/**
 * Pétales.
 *
 * Ils tombent de la couronne, dérivent, et disparaissent en touchant le sol.
 * Chacun tourne sur lui-même : une ellipse dont la largeur suit un cosinus du
 * temps, ce qui suffit à faire lire une vrille — un pétale qui descend à plat
 * ressemble à une chute de confettis.
 *
 * Ils ne tombent qu'à l'aplomb de la couronne. Un pétale à cinquante mètres de
 * l'arbre ne vient de nulle part, et l'œil le remarque tout de suite.
 */
export function drawPetals(ctx: CanvasRenderingContext2D, params: AmbienceParams): void {
  const { scale, palette } = params;
  const px = 1 / Math.max(scale, 0.002);
  const cell = 200 * px;
  const spanLeft = params.trunkX - params.canopyHalfWidth;
  const spanRight = params.trunkX + params.canopyHalfWidth;

  let painted = 0;
  for (const warm of [true, false]) {
    ctx.fillStyle = warm ? palette.petal : palette.petalAlt;
    for (const grain of field(params, 'petale', cell, cell * 0.75, cell * 2.6, 15)) {
      if (grain.roll > 0.4) continue;
      if (hashN('petale!c', grain.index) < 0.5 !== warm) continue;
      // Ni au-dessus de la cime, ni sous le sol, ni hors de l'ombre de l'arbre.
      if (grain.y > params.ground || grain.y < params.canopyTop - cell) continue;
      if (grain.x < spanLeft || grain.x > spanRight) continue;

      // Le balancement de la chute : un pétale ne descend pas, il se laisse
      // porter d'un côté puis de l'autre.
      const swing = Math.sin(params.time * 1.15 + grain.index * 1.3) * cell * 0.3;
      const size = px * (3 + hashN('petale!r', grain.index) * 3.4);
      // La vrille : la largeur apparente s'annule deux fois par tour, exactement
      // comme un pétale qui se présente de profil.
      const spin = Math.cos(params.time * 1.6 + grain.index);
      const alpha = envelope(grain.phase) * 0.85;
      if (alpha < 0.05) continue;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.ellipse(
        grain.x + swing,
        grain.y,
        Math.max(size * 0.14, size * Math.abs(spin)),
        size * 0.62,
        swing * 0.004,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      painted += 1;
      if (painted > 160) break;
    }
  }

  ctx.globalAlpha = 1;
}

/**
 * Cinq trajectoires, dont deux ou trois seulement traversent le cadre à un
 * instant donné. Au-delà, ce n'est plus un ciel, c'est une volière.
 */
const BIRDS = 5;

/**
 * Oiseaux au-dessus de la couronne.
 *
 * Ils ne servent à rien et c'est exactement leur fonction : une scène où le
 * seul mouvement possible est celui qu'on provoque soi-même reste une
 * interface. Quelque chose doit s'y passer sans nous.
 *
 * Ils ne paraissent qu'en vue éloignée. De près, on est dans les branches : on
 * ne regarde pas le ciel, et une silhouette grossie à cette distance deviendrait
 * un dessin d'oiseau, ce qu'aucune discrétion ne rattrape.
 *
 * Ils volent dans le haut du cadre, et devant l'arbre. Accrochés à la cime, ils
 * passaient au-dessus du bord de l'écran dès qu'on cadrait l'arbre entier ;
 * derrière le feuillage, ils disparaissaient dans la seule vue où on aurait pu
 * les voir. Un oiseau qui traverse devant une cime, c'est exactement ce qu'on
 * voit d'un jardin.
 */
export function drawBirds(ctx: CanvasRenderingContext2D, params: AmbienceParams): void {
  const { scale, palette } = params;
  if (scale > 0.14) return;

  const px = 1 / Math.max(scale, 0.002);
  const width = params.right - params.left;

  ctx.strokeStyle = palette.bird;
  ctx.lineWidth = px * 2.4;
  ctx.lineCap = 'round';

  for (let i = 0; i < BIRDS; i += 1) {
    const roll = hashN('oiseau', i);
    // Une traversée dure entre une et deux minutes : assez lent pour qu'on ne
    // suive pas l'oiseau du regard, assez vif pour qu'on le voie avancer si on
    // s'y attarde.
    const period = 74 + roll * 46;
    const phase = (params.time / period + roll) % 1;
    const heading = hashN('oiseau!d', i) < 0.5 ? 1 : -1;
    // La trajectoire couvre une fois et demie le cadre : l'oiseau entre et sort
    // hors champ, il n'apparaît jamais au milieu de l'écran.
    const travel = width * 1.25;
    const x = params.trunkX + heading * (phase - 0.5) * travel;
    // L'altitude se mesure sur la vue, jamais sur l'arbre : le haut du cadre est
    // le seul endroit dont on soit sûr qu'il est à l'écran.
    const y =
      params.viewTop +
      params.viewHeight * (0.1 + roll * 0.26) +
      Math.sin(params.time * 0.25 + i * 2.1) * px * 26;

    const size = px * (11 + roll * 7);
    // Le battement. Il ralentit puis s'arrête presque : un oiseau qui plane
    // bat trois fois puis se laisse porter, et cette irrégularité est la moitié
    // de ce qui le rend crédible.
    const beat = Math.sin(params.time * 3.1 + i * 1.7);
    const lift = beat * size * 0.5;

    ctx.globalAlpha = 0.62 + roll * 0.3;
    ctx.beginPath();
    ctx.moveTo(x - size, y - lift * 0.4);
    ctx.quadraticCurveTo(x - size * 0.45, y - lift, x, y);
    ctx.quadraticCurveTo(x + size * 0.45, y - lift, x + size, y - lift * 0.4);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/**
 * Les nuages.
 *
 * Ils vivent dans le monde, pas sur l'écran : ils dérivent au-dessus de la
 * cime, à la même échelle que l'arbre, et le vent qui les pousse est celui qui
 * couche l'herbe. Un ciel peint sur la vitre aurait coûté moins cher, mais il
 * se serait trahi au premier déplacement — un nuage qui suit le regard n'est
 * pas un nuage, c'est une tache sur l'objectif.
 *
 * Chaque nuage est fait de quelques bouffées en dégradé radial qui se
 * recouvrent : c'est le minimum pour obtenir un bord mou. Un contour net, si
 * bien dessiné soit-il, donne un autocollant.
 */
export function drawClouds(ctx: CanvasRenderingContext2D, params: AmbienceParams): void {
  const { scale, palette } = params;
  const px = 1 / Math.max(scale, 0.002);
  const height = params.bottom - params.top;
  // Le seul interdit : descendre sous l'horizon. Un nuage se voit derrière
  // l'arbre aussi bien qu'au-dessus — c'est même là qu'on le voit le plus
  // souvent, entre deux branches — mais jamais sous la ligne de terre.
  const ceiling = params.ground - height * 0.06;
  if (params.top > ceiling) return;

  const cell = 620 * px;
  let painted = 0;

  for (const grain of field(params, 'nuage', cell, cell * 1.9, 0, 96)) {
    if (grain.roll > 0.56) continue;
    if (grain.y > ceiling) continue;

    const size = px * (74 + hashN('nuage!t', grain.index) * 96);
    const alpha = envelope(grain.phase) * (0.72 + grain.roll * 0.9);
    if (alpha < 0.05) continue;

    // Le vent d'altitude : la même onde que dans l'herbe, mais amortie — un
    // nuage ne frissonne pas, il se déforme.
    const swell = 1 + Math.sin(params.time * 0.12 + grain.index) * 0.06;
    const puffs = 3 + Math.floor(hashN('nuage!n', grain.index) * 3);

    ctx.globalAlpha = Math.min(1, alpha);
    // Deux passes : le dessous froid, puis la face éclairée décalée vers le
    // haut. Un nuage d'une seule teinte disparaît sur un ciel pâle — c'est
    // l'ombre de son ventre qui le détache, pas son blanc.
    for (const under of [true, false]) {
      ctx.fillStyle = under ? palette.cloudShade : palette.cloud;
      for (let k = 0; k < puffs; k += 1) {
        const spread = (k / Math.max(1, puffs - 1) - 0.5) * 2;
        const rx = size * (1.15 - Math.abs(spread) * 0.42) * swell;
        const ry = rx * (0.44 + hashN(`nuage!h${grain.index}`, k) * 0.2);
        const cx = grain.x + spread * size * 1.5 + jitter(`nuage!x${grain.index}`, k, size * 0.3);
        // Le bas des bouffées s'aligne : c'est ce qui donne au cumulus sa base
        // plate, et au ciel sa hauteur.
        const cy =
          grain.y -
          ry * (0.25 + hashN(`nuage!y${grain.index}`, k) * 0.75) +
          (under ? ry * 0.3 : 0);

        const tint = under ? palette.cloudShade : palette.cloud;
        const puff = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
        puff.addColorStop(0, tint);
        puff.addColorStop(under ? 0.6 : 0.45, tint);
        puff.addColorStop(1, fade(tint));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        ctx.translate(-cx, -cy);
        ctx.beginPath();
        ctx.arc(cx, cy, rx, 0, Math.PI * 2);
        ctx.fillStyle = puff;
        ctx.fill();
        ctx.restore();
      }
    }

    painted += 1;
    if (painted > 14) break;
  }

  ctx.globalAlpha = 1;
}
