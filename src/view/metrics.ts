/** Dimensions du monde, partagées par le calcul de placement et par le rendu. */
export const CARD_WIDTH = 128;
export const CARD_HEIGHT = 152;

/** Écart entre deux frères et sœurs. */
export const SIBLING_GAP = 34;
/** Écart entre deux conjoints d'un même bloc. */
export const COUPLE_GAP = 24;
/** Écart entre deux familles racines indépendantes. */
export const FAMILY_GAP = 120;
/** Hauteur d'une génération. */
export const ROW_HEIGHT = 286;

/** Marge autour de l'arbre lors d'un recentrage. */
export const FIT_PADDING = 120;

/**
 * Un arbre de plusieurs centaines de personnes est très large et peu haut.
 * Le zoom minimal doit descendre assez bas pour en montrer toute l'étendue
 * d'un seul coup d'œil, sous forme de constellation.
 */
export const MIN_SCALE = 0.018;
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
