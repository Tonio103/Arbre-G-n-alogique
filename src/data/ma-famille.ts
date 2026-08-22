import type { FamilyDataset } from './schema';

/**
 * VOTRE FAMILLE.
 *
 * C'est le seul fichier qui décide de l'arbre affiché par défaut — celui que
 * verra quiconque ouvre ces fichiers, sans rien importer ni retoucher dans
 * l'application. Aucun composant d'interface ne connaît vos ancêtres : ils
 * lisent tous ce qui sort d'ici.
 *
 * ── Le plus simple : depuis l'application elle-même ─────────────────────────
 *
 * Construisez votre arbre dans l'application (import GEDCOM et/ou retouches
 * en place), puis « Importer/exporter vos données » → Télécharger en JSON.
 * Déposez le fichier téléchargé ici, sous le nom exact `ma-famille.json` :
 *
 *     src/data/ma-famille.json
 *
 * Rien d'autre à faire — la ligne ci-dessous le détecte tout seul et
 * remplace la démonstration par cet arbre pour tout le monde qui reçoit ces
 * fichiers, sans qu'ils aient à toucher au navigateur de qui que ce soit.
 * Aucun fichier à ce nom : la famille de démonstration reste affichée.
 */
const jsonModules = import.meta.glob('./ma-famille.json', { eager: true }) as Record<
  string,
  { default: FamilyDataset }
>;
const importedFamily = Object.values(jsonModules)[0]?.default ?? null;

/**
 * ── Ou à la main, en TypeScript ──────────────────────────────────────────────
 *
 * Si vous préférez saisir directement ici plutôt que passer par l'application
 * (utile pour un tout petit arbre, ou pour repartir de rien) : décommentez le
 * bloc ci-dessous. S'il est actif, il prend le pas sur `ma-famille.json`.
 *
 * Tant que `MA_FAMILLE` vaut `null` (ni fichier JSON, ni bloc décommenté),
 * l'application affiche la famille fictive des Beaumont.
 *
 * ── Ce qui se saisit ────────────────────────────────────────────────────────
 *
 * Une personne, au minimum :
 *
 *     { id: 'marie-durand-1912', firstName: 'Marie', lastName: 'Durand' }
 *
 * L'identifiant est libre — il ne sert qu'à relier les personnes entre elles.
 * La convention `prénom-nom-année` est la plus lisible quand on en saisit
 * plusieurs centaines.
 *
 * Seuls `parents` et `spouses` se déclarent. Les enfants, la fratrie, les
 * demi-frères et sœurs, les unions et les générations sont **déduits** au
 * chargement : il est donc impossible de saisir un lien d'un seul côté et de
 * se retrouver avec un arbre incohérent. Déclarer le conjoint sur l'une des
 * deux personnes suffit, le lien est symétrisé.
 *
 * Les dates acceptent l'imprécision des archives : `'1887'`, `'1887-04'`,
 * `'1887-04-23'` ou `'vers 1887'`.
 *
 * Tout le reste est facultatif. La liste complète des champs est dans
 * `schema.ts` — et `custom` accepte n'importe quelle paire clé/valeur, qui
 * s'affichera telle quelle dans la fiche.
 *
 * ── Ce qui est relu ─────────────────────────────────────────────────────────
 *
 * Au chargement, l'arbre est relu : parent inconnu, identifiant en double,
 * enfant né après la mort de son parent, mariage avant la naissance… Rien
 * n'est corrigé ni bloqué — un arbre réel a ses zones douteuses — mais tout
 * est signalé, dans la console et sur un bandeau dans l'application.
 */
export const MA_FAMILLE: FamilyDataset | null = importedFamily;

/*
export const MA_FAMILLE: FamilyDataset | null = {
  title: 'Durand — Petit',
  subtitle: 'De Saint-Malo à Lyon, cinq générations',
  // Personne mise en avant à l'ouverture. À défaut, la plus ancienne.
  rootId: 'marie-durand-1912',

  // Étiquettes affichées en vue éloignée, pour se repérer dans un grand arbre.
  // Chacune nomme l'espace occupé par la descendance de la personne visée.
  branches: [{ label: 'Branche de Saint-Malo', anchorId: 'jean-durand-1880' }],

  people: [
    {
      id: 'jean-durand-1880',
      firstName: 'Jean',
      lastName: 'Durand',
      gender: 'm',
      birthDate: '1880-02-14',
      birthPlace: 'Saint-Malo',
      deathDate: '1951-11-03',
      profession: 'Charpentier de marine',
      headline: 'Charpentier de marine',
      spouses: [{ id: 'louise-petit-1884', status: 'married', since: '1908-06-20' }],
    },
    {
      id: 'louise-petit-1884',
      firstName: 'Louise',
      lastName: 'Durand',
      maidenName: 'Petit',
      gender: 'f',
      birthDate: '1884',
      deathDate: '1969',
    },
    {
      id: 'marie-durand-1912',
      firstName: 'Marie',
      lastName: 'Durand',
      gender: 'f',
      birthDate: '1912-09-01',
      birthPlace: 'Saint-Malo',
      profession: 'Institutrice',
      biography: 'Elle a tenu la classe unique du village pendant trente et un ans.',
      interests: ['Botanique', 'Chorale'],
      anecdotes: ['Gardait une carte du Finistère punaisée au-dessus de son lit.'],
      milestones: [{ year: '1934', title: 'Nommée à Plouër-sur-Rance' }],
      memories: ['L’odeur de la craie et du poêle à bois.'],
      custom: { 'Décoration': 'Palmes académiques, 1962' },
      parents: ['jean-durand-1880', 'louise-petit-1884'],
    },
  ],
};
*/
