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
 * Juste de quoi loger une carte et le trait qui descend vers la suivante. Un
 * diagramme se lit d'autant mieux qu'il est compact : l'espace vide entre deux
 * rangées n'apporte rien, il éloigne seulement un enfant de ses parents.
 */
export const ROW_HEIGHT = 230;

/** Marge autour de l'arbre lors d'un recentrage. */
export const FIT_PADDING = 120;

/**
 * Bornes absolues du zoom.
 *
 * `MIN_SCALE` n'est qu'un plancher de sécurité pour les très grands arbres :
 * la vraie limite est calculée à l'exécution par `ViewportController`, qui
 * empêche de dézoomer au-delà de ce qui montre l'arbre entier. Sans elle,
 * un arbre de huit personnes se laissait réduire à un point perdu au milieu
 * du vide, sans rien pour dire dans quel sens revenir.
 */
export const MIN_SCALE = 0.02;
export const MAX_SCALE = 2.4;

/**
 * Marge de dézoom au-delà du cadrage complet.
 *
 * À 1, on ne pourrait pas reculer d'un pixel de plus que l'arbre entier — un
 * mur, juste au moment où l'on cherche à prendre du recul. Il faut donc un
 * peu de rab.
 *
 * Ce rab valait 0,55, c'est-à-dire quarante-cinq pour cent de recul EN PLUS
 * d'un cadrage qui réserve déjà 120 px de marge de chaque côté. Les deux se
 * multipliaient : mesuré sur l'arbre de démonstration dans un cadre de
 * 1300 × 820, le dézoom maximal laissait l'arbre à 219 × 319 px — dix-sept
 * pour cent de la largeur, un objet perdu au milieu du vide. Ce n'était plus
 * « de quoi respirer », c'était une pièce trop grande.
 *
 * À 0,82, il reste dix-huit pour cent de recul au-delà du cadrage complet :
 * assez pour ne pas buter contre un mur, trop peu pour perdre l'arbre.
 */
export const MIN_SCALE_FIT_RATIO = 0.82;

/** Seuils de niveau de détail : au-delà, on dégrade le rendu pour tenir la fluidité. */
export const LOD_FULL = 0.52;
export const LOD_COMPACT = 0.24;

export const cardCenterX = (x: number): number => x + CARD_WIDTH / 2;
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
/** Centre du portrait : hauteur du trait qui unit deux conjoints. */
export const portraitCenterY = (y: number): number => y + PORTRAIT_TOP + PORTRAIT_RADIUS;
