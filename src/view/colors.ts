/**
 * Éteindre une couleur sans la salir.
 *
 * Un dégradé de canvas interpole ses arrêts composante par composante, en
 * couleur non prémultipliée. Terminer par le mot-clé `transparent` — qui vaut
 * `rgba(0, 0, 0, 0)` — fait donc glisser la teinte vers le noir en même temps
 * que l'opacité tombe : un nuage blanc s'entoure d'une auréole grise, une
 * terre brune vire au gris de cendre à mi-parcours. Le défaut est invisible
 * sur une couleur déjà sombre, et sauteur aux yeux sur une couleur claire.
 *
 * La règle est simple : un dégradé qui s'éteint garde sa couleur jusqu'au
 * bout et ne perd que son alpha.
 */
export function fade(color: string): string {
  const trimmed = color.trim();

  const functional = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (functional) {
    // Les trois premières composantes suffisent : la quatrième, s'il y en a
    // une, est précisément celle qu'on remplace.
    const parts = functional[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, 0)`;
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((d) => d + d)
            .join('')
        : hex[1];
    const value = parseInt(digits, 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, 0)`;
  }

  // Teinte non reconnue (un nom CSS, une couleur système) : le mot-clé reste le
  // seul recours, avec son défaut.
  return 'transparent';
}
