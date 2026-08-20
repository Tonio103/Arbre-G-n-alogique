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
/** Hauteur d'une génération. */
export const ROW_HEIGHT = 1150;

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
