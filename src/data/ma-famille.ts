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
/*
const jsonModules = import.meta.glob('./ma-famille.json', { eager: true }) as Record<
  string,
  { default: FamilyDataset }
>;
const importedFamily = Object.values(jsonModules)[0]?.default ?? null;
*/

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
/*
 * La famille de démonstration est désormais désactivée : `MA_FAMILLE` n'est
 * plus `importedFamily` (qui retomberait sur les Beaumont fictifs tant
 * qu'aucun GEDCOM ou JSON n'est importé), mais le noyau ci-dessous — Antoine
 * et Stella Albertini, frère et sœur. Le reste de la famille (parents,
 * grands-parents de chaque côté, autres fratries…) se construit depuis
 * l'application elle-même, fiche après fiche, avec « Ajouter un proche » :
 * inventer ici des noms qu'on ne connaît pas produirait un arbre faux plutôt
 * qu'un arbre incomplet.
 *
 * Un frère et une sœur ne se déclarent pas directement — voir `schema.ts` :
 * la fratrie est *déduite* d'un parent partagé, pas saisie comme un lien à
 * part, pour qu'il soit impossible de la renseigner d'un côté sans l'autre.
 * `parent-albertini` ci-dessous n'est donc pas une personne inventée : c'est
 * un support délibérément vide, à renommer avec le vrai nom du parent depuis
 * sa fiche (« Modifier ») dès qu'il est connu.
 */
export const MA_FAMILLE: FamilyDataset | null = {
  title: 'Famille Albertini',
  rootId: 'antoine-albertini',

  people: [
    {
      id: 'parent-albertini',
      firstName: 'Parent',
      lastName: 'Albertini',
      notes: 'Fiche à compléter avec le vrai nom de ce parent — voir « Modifier ».',
    },
    {
      id: 'antoine-albertini',
      firstName: 'Antoine',
      lastName: 'Albertini',
      gender: 'm',
      parents: ['parent-albertini'],
    },
    {
      id: 'stella-albertini',
      firstName: 'Stella',
      lastName: 'Albertini',
      gender: 'f',
      parents: ['parent-albertini'],
    },
  ],
};

/*
export const MA_FAMILLE: FamilyDataset | null = importedFamily;
*/
