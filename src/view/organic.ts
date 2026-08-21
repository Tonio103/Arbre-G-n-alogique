/**
 * Ce qui sépare un schéma d'un arbre.
 *
 * Une ramure tracée à la règle se reconnaît immédiatement : toutes les branches
 * partent du même angle, se courbent de la même façon, portent les mêmes
 * feuilles. Un arbre réel n'a aucune symétrie — chaque branche a dévié pour
 * chercher la lumière, chaque rameau porte un nombre différent de feuilles.
 *
 * Ce module fournit cette irrégularité. Elle doit être **déterministe** : la
 * même personne produit la même forme à chaque image, sinon l'arbre frémirait
 * à chaque déplacement. Un hachage de l'identifiant remplace donc le hasard.
 */

/**
 * Hachage FNV-1a, ramené dans [0, 1).
 *
 * Rapide, sans état, et surtout stable : deux exécutions, deux machines et deux
 * sessions donnent le même nombre pour le même identifiant.
 */
export function hash01(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Le décalage non signé écarte le bit de signe, qui rendrait la moitié des
  // valeurs négatives.
  return ((h >>> 0) % 100000) / 100000;
}

/** Variante du hachage : plusieurs valeurs indépendantes pour une même graine. */
export function hashN(seed: string, index: number): number {
  return hash01(`${seed}#${index}`);
}

/** Valeur centrée dans [-amplitude, +amplitude]. */
export function jitter(seed: string, index: number, amplitude: number): number {
  return (hashN(seed, index) - 0.5) * 2 * amplitude;
}

/**
 * Feuille, en amande.
 *
 * Deux courbes quadratiques symétriques : c'est la forme la plus économique qui
 * se lise encore comme une feuille à quelques pixels, et elle ne coûte que deux
 * segments par contour.
 */
export function traceLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Axe de la feuille, puis sa perpendiculaire : tout le reste s'exprime dans
  // ce repère local, ce qui évite de manipuler la matrice du contexte.
  const tipX = x + cos * length;
  const tipY = y + sin * length;
  const halfX = (-sin * width) / 2;
  const halfY = (cos * width) / 2;
  const midX = x + cos * length * 0.42;
  const midY = y + sin * length * 0.42;

  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(midX + halfX, midY + halfY, tipX, tipY);
  ctx.quadraticCurveTo(midX - halfX, midY - halfY, x, y);
}

/**
 * Amas de feuilles au bout d'un rameau.
 *
 * Les feuilles se répartissent dans un éventail orienté vers le haut, avec des
 * longueurs et des angles tirés du hachage : deux rameaux voisins n'ont jamais
 * la même touffe, ce qui suffit à faire disparaître l'impression de motif
 * répété.
 */
export function traceLeafCluster(
  ctx: CanvasRenderingContext2D,
  seed: string,
  x: number,
  y: number,
  size: number,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const spread = count === 1 ? 0 : i / (count - 1) - 0.5;
    // Éventail ouvert vers le haut, resserré : au-delà d'une trentaine de
    // degrés d'écart la touffe se lit comme une palme et non comme un rameau.
    const angle = -Math.PI / 2 + spread * 1.15 + jitter(seed, i * 3, 0.3);
    const length = size * (0.6 + hashN(seed, i * 3 + 1) * 0.5);
    const offsetX = jitter(seed, i * 3 + 2, size * 0.3);
    const offsetY = jitter(seed, i * 3 + 7, size * 0.22);
    traceLeaf(ctx, x + offsetX, y + offsetY, length, length * 0.34, angle);
  }
}

/**
 * Couronne de feuilles autour d'une extrémité.
 *
 * Un rameau qui s'achève ne porte pas une gerbe dressée : il porte une touffe
 * qui s'ouvre dans toutes les directions sauf celle d'où il vient. L'éventail
 * vertical se lisait comme une herbe plantée sur la tête des personnes ; la
 * couronne, elle, les entoure — le médaillon vient s'y poser au premier plan,
 * exactement comme un fruit dans son feuillage.
 *
 * Le secteur du bas reste libre : c'est par là qu'arrive la branche, et une
 * feuille qui y pousserait sortirait du bois.
 */
export function traceLeafCrown(
  ctx: CanvasRenderingContext2D,
  seed: string,
  cx: number,
  cy: number,
  radius: number,
  size: number,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const spread = count === 1 ? 0 : i / (count - 1) - 0.5;
    // 280 degrés : le tour complet moins le secteur par lequel monte le rameau.
    const angle = -Math.PI / 2 + spread * 4.9 + jitter(seed, i * 4, 0.26);
    const arm = radius * (0.62 + hashN(seed, i * 4 + 1) * 0.66);
    // Courtes et larges. Des feuilles longues et fines transforment la couronne
    // en palme, et la masse du feuillage — ce qui fait une cime — n'apparaît
    // jamais : il faut que les touffes voisines se recouvrent.
    const length = size * (0.3 + hashN(seed, i * 4 + 2) * 0.3);
    traceLeaf(
      ctx,
      cx + Math.cos(angle) * arm,
      cy + Math.sin(angle) * arm,
      length,
      length * 0.46,
      angle + jitter(seed, i * 4 + 3, 0.22),
    );
  }
}

/**
 * Stries d'écorce le long d'un fût vertical.
 *
 * Elles ne sont dessinées que lorsque le tronc est assez large à l'écran pour
 * qu'on les distingue ; en dessous, elles se réduiraient à un bruit gris qui
 * salirait la silhouette au lieu de l'enrichir.
 */
export function traceBark(
  ctx: CanvasRenderingContext2D,
  seed: string,
  x: number,
  topY: number,
  bottomY: number,
  width: number,
  count: number,
): void {
  const height = bottomY - topY;
  if (height <= 0) return;

  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    // Les stries suivent le fuseau du tronc : plus resserrées vers le haut,
    // où le fût est plus fin.
    const offset = (t - 0.5) * width * 0.78;
    const startY = topY + height * (0.04 + hashN(seed, i * 2) * 0.22);
    const endY = bottomY - height * (0.05 + hashN(seed, i * 2 + 1) * 0.3);
    if (endY <= startY) continue;

    const bend = jitter(seed, i * 2 + 11, width * 0.06);
    // Effilée aux deux bouts : une strie d'épaisseur constante se lit comme une
    // planche collée sur le tronc, pas comme un pli d'écorce.
    const thickness = width * (0.005 + hashN(seed, i * 2 + 5) * 0.011);
    const midY = (startY + endY) / 2;

    ctx.moveTo(x + offset, startY);
    ctx.quadraticCurveTo(x + offset + bend - thickness, midY, x + offset * 0.82, endY);
    ctx.quadraticCurveTo(x + offset + bend + thickness, midY, x + offset, startY);
    ctx.closePath();
  }
}
