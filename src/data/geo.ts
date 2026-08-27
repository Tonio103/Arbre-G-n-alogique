/**
 * Coordonnées géographiques des lieux cités dans les données (naissances,
 * décès, résidences). Couvre exactement les lieux utilisés par `core-family.ts`,
 * `ma-famille.ts` et les régions de `vocabulary.ts` — un lieu absent d'ici
 * n'apparaît simplement pas sur la carte plutôt que de la faire échouer.
 */
export const PLACE_COORDS: Record<string, [lat: number, lon: number]> = {
  // Vaucluse
  'Fontaine-de-Vaucluse': [43.918, 5.126],
  'L’Isle-sur-la-Sorgue': [43.919, 5.051],
  Carpentras: [44.055, 5.048],
  Apt: [43.879, 5.395],
  Avignon: [43.949, 4.806],
  'Pernes-les-Fontaines': [43.998, 5.061],
  Gordes: [43.911, 5.2],
  Cavaillon: [43.838, 5.037],
  Sault: [44.088, 5.408],
  'Le Thor': [43.929, 4.994],
  Velleron: [43.978, 5.056],
  'Saumane-de-Vaucluse': [43.936, 5.131],

  // Côte-d'Or
  Beaune: [47.026, 4.84],
  'Nuits-Saint-Georges': [47.135, 4.949],
  Meursault: [46.976, 4.769],
  Dijon: [47.322, 5.041],
  Chagny: [46.913, 4.752],
  'Savigny-lès-Beaune': [47.055, 4.822],
  Pommard: [46.987, 4.804],
  'Aloxe-Corton': [47.062, 4.868],
  'Gevrey-Chambertin': [47.226, 4.953],
  Santenay: [46.905, 4.699],

  // Finistère
  Quimper: [47.996, -4.098],
  Concarneau: [47.874, -3.921],
  Douarnenez: [48.093, -4.329],
  'Pont-l’Abbé': [47.864, -4.204],
  Locronan: [48.1, -4.196],
  Audierne: [48.023, -4.545],
  Bénodet: [47.874, -4.117],
  'Plogastel-Saint-Germain': [47.968, -4.264],

  // Nord
  Lille: [50.629, 3.057],
  Roubaix: [50.69, 3.174],
  Armentières: [50.688, 2.88],
  Douai: [50.371, 3.079],
  Valenciennes: [50.358, 3.523],
  Tourcoing: [50.723, 3.161],
  Bailleul: [50.733, 2.734],
  Seclin: [50.554, 3.033],

  // Île-de-France
  'Paris 11e': [48.859, 2.38],
  'Paris 14e': [48.83, 2.326],
  'Paris 20e': [48.863, 2.401],
  Vincennes: [48.847, 2.438],
  Montreuil: [48.861, 2.443],
  'Saint-Mandé': [48.847, 2.416],
  'Ivry-sur-Seine': [48.813, 2.386],
  'Asnières-sur-Seine': [48.914, 2.286],
  Sceaux: [48.778, 2.29],
  'Nogent-sur-Marne': [48.838, 2.483],

  // Rhône
  'Lyon 4e': [45.774, 4.829],
  'Lyon 7e': [45.741, 4.842],
  Villeurbanne: [45.767, 4.88],
  Oullins: [45.716, 4.809],
  'Tassin-la-Demi-Lune': [45.76, 4.777],
  'Caluire-et-Cuire': [45.793, 4.845],
  Vienne: [45.525, 4.874],

  // Lieux hors régions du générateur, cités tels quels dans la lignée fondatrice
  'Aix-en-Provence': [43.529, 5.447],
  Craonne: [49.433, 3.793],
  Grenoble: [45.188, 5.724],
  Montpellier: [43.611, 3.877],
  Nîmes: [43.837, 4.36],
  'Saint-Malo': [48.649, -2.026],
  Valence: [44.933, 4.892],

  // Lieux relevés dans les données importées (Bretagne nord, Normandie, Sud)
  Plouha: [48.68, -2.929],
  'Saint-Gilles-les-Bois': [48.617, -3.033],
  Paimpol: [48.779, -3.045],
  'Saint-Brieuc': [48.514, -2.765],
  Guingamp: [48.562, -3.151],
  Lannion: [48.733, -3.458],
  'Le Havre': [49.494, 0.108],
  'La Ciotat': [43.175, 5.604],
  'Lagny-sur-Marne': [48.873, 2.705],
  Paris: [48.857, 2.352],

  // Corse — patronymes Albertini, Mattei, Vanucci
  Bastia: [42.703, 9.451],
  Ajaccio: [41.919, 8.739],
  Corte: [42.306, 9.149],
  Calvi: [42.567, 8.757],
  'Porto-Vecchio': [41.591, 9.279],
  Bonifacio: [41.388, 9.159],
  Sartène: [41.619, 8.974],
  'L’Île-Rousse': [42.634, 8.937],

  // Grandes villes, pour la suite de la saisie
  Marseille: [43.296, 5.37],
  Lyon: [45.764, 4.836],
  Toulouse: [43.605, 1.444],
  Nice: [43.71, 7.262],
  Nantes: [47.218, -1.554],
  Bordeaux: [44.838, -0.579],
  Strasbourg: [48.573, 7.752],
  Toulon: [43.124, 5.928],
  Rennes: [48.117, -1.678],
  Brest: [48.39, -4.486],
  Rouen: [49.443, 1.1],
  Caen: [49.183, -0.371],
  Reims: [49.258, 4.032],
  Metz: [49.119, 6.176],
  Nancy: [48.692, 6.184],
  Angers: [47.478, -0.563],
  Tours: [47.394, 0.685],
  Orléans: [47.903, 1.909],
  Limoges: [45.834, 1.261],
  'Clermont-Ferrand': [45.777, 3.087],
  Besançon: [47.238, 6.024],
  Perpignan: [42.689, 2.895],
  Versailles: [48.801, 2.13],
  'Boulogne-Billancourt': [48.835, 2.241],
  'Saint-Denis': [48.936, 2.357],
  Argenteuil: [48.947, 2.247],
  Meaux: [48.96, 2.888],
  Melun: [48.539, 2.661],
  Créteil: [48.79, 2.456],
  Nanterre: [48.892, 2.207],
  Cannes: [43.553, 7.017],
  Antibes: [43.581, 7.125],
  Bayonne: [43.493, -1.475],
  Pau: [43.295, -0.371],
  'La Rochelle': [46.159, -1.152],
  Poitiers: [46.58, 0.34],
  Amiens: [49.894, 2.296],
  Dunkerque: [51.034, 2.377],
  Cherbourg: [49.639, -1.616],
  'Saint-Nazaire': [47.274, -2.214],
};

/**
 * Ramène un nom de lieu à une clé comparable.
 *
 * Les archives et les saisies successives écrivent « St-Gille-le-Bois »,
 * « Saint-Gilles-les-Bois », « PARIS 20 » ou « Bastia, Haute-Corse » pour des
 * endroits qu'il faut rapprocher. On enlève les accents, la ponctuation et les
 * numéros d'arrondissement, et on développe « st ».
 *
 * Le rapprochement est purement orthographique : il ne suppose jamais une
 * géographie. Deux graphies voisines désignent le même point, un nom inconnu
 * reste inconnu.
 */
export function placeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bs(?:ain)?te\b\.?/g, 'sainte')
    .replace(/\bs(?:ain)?t\b\.?/g, 'saint')
    .replace(/\b\d+\s*(?:er|e|eme)?\b/g, ' ')
    .replace(/\b(?:arrondissement|cedex)\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

const BY_KEY = new Map<string, { label: string; lat: number; lon: number }>();
for (const [label, [lat, lon]] of Object.entries(PLACE_COORDS)) {
  const key = placeKey(label);
  if (!key) continue;
  const held = BY_KEY.get(key);
  /*
   * Les arrondissements tombent tous sur la même clé que leur ville : « Paris
   * 11e », « Paris 20 » et « Paris » donnent `paris`. On garde alors l'entrée
   * la plus générale — celle sans chiffre — sinon un lieu écrit « Paris 20 »
   * s'afficherait sous le nom « Paris 11e », ce qui serait faux. Trois
   * kilomètres d'écart ne se voient pas à l'échelle de la France ; un nom
   * erroné, si.
   */
  if (held && /\d/.test(label)) continue;
  if (held && !/\d/.test(held.label)) continue;
  BY_KEY.set(key, { label, lat, lon });
}
// Graphies fautives rencontrées dans les données, rattachées à leur commune.
BY_KEY.set('saint-gille-le-bois', BY_KEY.get('saint-gilles-les-bois')!);

/**
 * Les coordonnées d'un lieu, ou `undefined` s'il n'est pas répertorié.
 *
 * Un lieu inconnu n'est jamais placé au jugé : sur une carte, une position est
 * une affirmation. Les vues l'affichent alors dans une liste à part.
 */
export function locatePlace(
  raw: string,
): { label: string; lat: number; lon: number } | undefined {
  const direct = BY_KEY.get(placeKey(raw));
  if (direct) return direct;
  // « Commune, département, pays » : on essaie chaque partie, jamais un
  // découpage ailleurs qu'aux virgules — « Saint-Denis » n'est pas « Denis ».
  for (const part of raw.split(',')) {
    const entry = BY_KEY.get(placeKey(part));
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Silhouette très simplifiée de la France, juste assez de points pour se
 * reconnaître à la taille d'un médaillon de vignette — pas un tracé
 * cartographique fidèle.
 */
export const FRANCE_OUTLINE: Array<[lat: number, lon: number]> = [
  [51.05, 2.37], // Dunkerque
  [50.95, 1.85], // Calais
  [49.65, -1.62], // Cherbourg
  [48.65, -2.03], // Saint-Malo
  [48.39, -4.49], // Brest
  [47.87, -4.29], // pointe bretonne sud
  [47.28, -2.21], // Saint-Nazaire
  [46.16, -1.15], // La Rochelle
  [44.66, -1.15], // bassin d'Arcachon
  [43.37, -1.77], // Hendaye
  [42.9, -0.5], // Pyrénées ouest
  [42.63, 2.9], // Perpignan
  [43.2, 5.75], // delta du Rhône
  [43.3, 5.37], // Marseille
  [43.7, 7.27], // Nice
  [43.79, 7.51], // Menton
  [44.1, 7.1], // Alpes du sud
  [45.9, 7.0], // Alpes du nord
  [47.3, 7.0], // Jura
  [48.58, 7.75], // Strasbourg
  [49.35, 6.2], // Lorraine
  [49.95, 4.9], // Ardennes
  [51.05, 2.37], // retour Dunkerque
];
