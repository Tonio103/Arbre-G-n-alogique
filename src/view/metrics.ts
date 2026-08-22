/*
 * Dimensions du monde, partagées par le calcul de placement et par le rendu.
 *
 * Ces six nombres décident de la silhouette de l'arbre. La largeur totale vaut
 * à peu près le nombre de personnes de la génération la plus fournie multiplié
 * par (CARD_WIDTH + SIBLING_GAP) ; la hauteur vaut le nombre de générations
 * multiplié par ROW_HEIGHT. Un médaillon large étale l'arbre en frise : c'est
 * le rapport entre ces deux familles de valeurs qui fait qu'on reconnaît un
 * arbre ou une étagère.
 */
export const CARD_WIDTH = 78;
export const CARD_HEIGHT = 100;

/** Écart entre deux frères et sœurs. */
export const SIBLING_GAP = 14;
/** Écart entre deux conjoints d'un même bloc. */
export const COUPLE_GAP = 10;
/** Écart entre deux familles racines indépendantes. */
export const FAMILY_GAP = 52;
/*
 * Hauteur d'une génération.
 *
 * C'est le réglage qui arbitre entre la silhouette et la lecture. Trop courte,
 * l'arbre s'aplatit en frise ; trop haute, chaque filiation devient une longue
 * ligne qui traverse un vide, et une fratrie n'est plus qu'un faisceau de
 * traits parallèles dont on ne sait plus ce qu'il relie.
 *
 * Elle vaut maintenant la moitié de plus qu'avant. Depuis que les premières
 * générations se resserrent sur le tronc — voir `crownSpread` — la largeur ne
 * grandit plus avec la hauteur : l'arbre pouvait donc s'élever sans se coucher.
 */
export const ROW_HEIGHT = 1080;

/** Marge autour de l'arbre lors d'un recentrage. */
export const FIT_PADDING = 120;

/**
 * Un arbre de plusieurs centaines de personnes est très large et peu haut.
 * Le zoom minimal doit descendre assez bas pour en montrer toute l'étendue
 * d'un seul coup d'œil, sous forme de constellation.
 */
export const MIN_SCALE = 0.006;
export const MAX_SCALE = 2.4;

/** Seuils de niveau de détail : au-delà, on dégrade le rendu pour tenir la fluidité. */
export const LOD_FULL = 0.52;
export const LOD_COMPACT = 0.24;
/** Au-dessus de cette densité de cartes visibles, on coupe le flou d'arrière-plan. */
export const BLUR_BUDGET = 90;

export const cardCenterX = (x: number): number => x + CARD_WIDTH / 2;
export const cardCenterY = (y: number): number => y + CARD_HEIGHT / 2;
export const cardTop = (y: number): number => y;
export const cardBottom = (y: number): number => y + CARD_HEIGHT;

/*
 * Points d'attache des branches.
 *
 * Un médaillon n'est pas plein : le portrait occupe sa partie haute, le nom est
 * posé dessous. Accrocher les branches aux bords de la boîte les fait donc
 * arriver sous le texte, à quarante-cinq unités du portrait — elles semblent
 * ne toucher personne. Le lien doit rejoindre le portrait lui-même, qui est ce
 * que l'œil identifie à la personne.
 *
 * Ces valeurs doublent celles de `node.css` (padding et taille de l'avatar) :
 * les modifier d'un côté impose de les modifier de l'autre.
 */
export const PORTRAIT_TOP = 5;
export const PORTRAIT_SIZE = 50;
export const PORTRAIT_RADIUS = PORTRAIT_SIZE / 2;

/** Haut du portrait : d'où part une branche qui monte vers la descendance. */
export const portraitTop = (y: number): number => y + PORTRAIT_TOP;
/** Bas du portrait : où arrive la branche venant des parents. */
export const portraitBottom = (y: number): number => y + PORTRAIT_TOP + PORTRAIT_SIZE;
/** Centre du portrait : hauteur du trait qui unit deux conjoints. */
export const portraitCenterY = (y: number): number => y + PORTRAIT_TOP + PORTRAIT_RADIUS;
