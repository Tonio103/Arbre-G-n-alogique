/* ═══════════════════════════════════════════════════════════════════════════
 * LA GÉOGRAPHIE DU WEB, EN UN SEUL ENDROIT
 *
 * La projection de Mercator sphérique et le découpage en tuiles qu'emploient
 * toutes les cartes en ligne. Trois vues s'en servent désormais — la grande
 * carte, la vignette de coin et l'acte des lieux du film — et les trois
 * doivent poser un marqueur au MÊME pixel : un lieu qui saute de trois pixels
 * en passant d'une vue à l'autre se remarque immédiatement.
 *
 * `cadrePourLieux` répond à la question que se posent la vignette et le film,
 * et que la grande carte ne se pose pas : quel niveau de tuile, et quel
 * centre, pour que TOUS ces lieux tiennent dans un rectangle donné.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const TUILE = 256;

export const tuileX = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;

export const tuileY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};

export interface Tuile {
  x: number;
  y: number;
  left: number;
  top: number;
}

export interface Cadre {
  z: number;
  tuiles: Tuile[];
  /** Où tombe un point du globe dans le rectangle, en pixels. */
  projeter: (lat: number, lon: number) => { x: number; y: number };
}

export interface PointGeo {
  lat: number;
  lon: number;
}

const Z_MIN = 3;
const Z_MAX = 12;

/**
 * Le cadre le plus SERRÉ qui fasse tenir tous ces points.
 *
 * On descend depuis le niveau le plus fin : le premier qui convient est le
 * bon. Chercher en montant depuis le plus large donnerait le même résultat en
 * plus d'itérations — et il y a un cas où l'on ne trouverait rien, celui d'un
 * point unique : l'étendue est alors nulle, tous les niveaux conviennent, et
 * l'on prend le plus fin. C'est exactement ce qu'on veut d'un lieu isolé.
 *
 * `marge` est une fraction du rectangle, de chaque côté. Elle sert à ce
 * qu'aucune marque ne touche le bord ; au-delà de ce service elle ne coûte
 * qu'un niveau de tuile, c'est-à-dire la moitié de la finesse.
 */
export function cadrePourLieux(
  points: PointGeo[],
  largeur: number,
  hauteur: number,
  marge = 0.08,
): Cadre | null {
  if (points.length === 0) return null;

  let latMin = Infinity;
  let latMax = -Infinity;
  let lonMin = Infinity;
  let lonMax = -Infinity;
  for (const point of points) {
    latMin = Math.min(latMin, point.lat);
    latMax = Math.max(latMax, point.lat);
    lonMin = Math.min(lonMin, point.lon);
    lonMax = Math.max(lonMax, point.lon);
  }

  const utileW = largeur * (1 - marge * 2);
  const utileH = hauteur * (1 - marge * 2);
  let z = Z_MIN;
  for (let essai = Z_MAX; essai >= Z_MIN; essai -= 1) {
    const large = (tuileX(lonMax, essai) - tuileX(lonMin, essai)) * TUILE;
    const haut = (tuileY(latMin, essai) - tuileY(latMax, essai)) * TUILE;
    if (large <= utileW && haut <= utileH) {
      z = essai;
      break;
    }
  }

  const origine = {
    x: ((tuileX(lonMin, z) + tuileX(lonMax, z)) / 2) * TUILE - largeur / 2,
    y: ((tuileY(latMax, z) + tuileY(latMin, z)) / 2) * TUILE - hauteur / 2,
  };

  const compte = 2 ** z;
  const tuiles: Tuile[] = [];
  const txDebut = Math.max(0, Math.floor(origine.x / TUILE));
  const txFin = Math.min(compte - 1, Math.floor((origine.x + largeur) / TUILE));
  const tyDebut = Math.max(0, Math.floor(origine.y / TUILE));
  const tyFin = Math.min(compte - 1, Math.floor((origine.y + hauteur) / TUILE));
  for (let tx = txDebut; tx <= txFin; tx += 1) {
    for (let ty = tyDebut; ty <= tyFin; ty += 1) {
      tuiles.push({ x: tx, y: ty, left: tx * TUILE - origine.x, top: ty * TUILE - origine.y });
    }
  }

  return {
    z,
    tuiles,
    projeter: (lat, lon) => ({
      x: tuileX(lon, z) * TUILE - origine.x,
      y: tuileY(lat, z) * TUILE - origine.y,
    }),
  };
}

/** L'adresse d'une tuile chez OpenStreetMap. */
export const urlTuile = (z: number, x: number, y: number): string =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
