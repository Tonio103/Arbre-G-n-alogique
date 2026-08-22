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
};

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
