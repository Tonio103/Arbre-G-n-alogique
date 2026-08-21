/**
 * Le hasard reproductible.
 *
 * Deux parties de l'application ont besoin d'irrégularité : la mise en page,
 * pour que les rangées ne soient pas tirées à la règle, et le rendu, pour que
 * la ramure n'ait pas la symétrie d'un schéma. Toutes deux exigent la même
 * chose du hasard — qu'il n'en soit pas un. La même personne doit produire la
 * même valeur à chaque image, à chaque session et sur chaque machine ; sinon
 * l'arbre frémit dès qu'on le déplace, et deux écrans côte à côte ne montrent
 * pas le même arbre.
 *
 * Ce module est délibérément sous `lib` : ni le domaine ne dépend du rendu, ni
 * l'inverse.
 */

/**
 * Hachage FNV-1a, ramené dans [0, 1).
 *
 * Rapide, sans état, et stable d'une exécution à l'autre.
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
