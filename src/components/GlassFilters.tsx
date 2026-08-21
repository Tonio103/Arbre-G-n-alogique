/**
 * L'optique du verre.
 *
 * Le CSS sait flouter, teinter, éclairer une arête. Il ne sait pas **courber**
 * ce qui se trouve derrière une surface — or c'est exactement ce qui distingue
 * une plaque de verre d'un rectangle translucide. Deux phénomènes sont
 * reproduits ici, et tous deux demandent un filtre.
 *
 *  1. LA LENTILLE
 *     Une plaque de verre est plane en son centre et courbe sur ses bords. Ce
 *     qu'on voit à travers est donc net au milieu, puis de plus en plus étiré
 *     à mesure qu'on approche du bord. Le déplacement doit croître de façon
 *     continue : une bande de bord franche produit une couture visible là où la
 *     déformation démarre, ce qui trahit immédiatement le procédé.
 *
 *  2. LA DISPERSION
 *     Le verre ne dévie pas toutes les longueurs d'onde du même angle : une
 *     frange colorée apparaît sur les bords d'une épaisseur réelle.
 *
 *     Séparer les trois canaux, les déplacer différemment puis les recomposer
 *     est la méthode exacte — et elle ne tient pas ici : les filtres SVG
 *     travaillent en alpha prémultiplié, si bien que la recomposition d'un
 *     arrière-plan translucide perd sa luminosité et laisse des franges cyan
 *     très visibles au lieu d'un liseré discret. La frange est donc portée par
 *     l'arête spéculaire, en CSS, où elle reste sous contrôle.
 *
 * Le principe technique : une carte de déplacement encode dans son canal rouge
 * le décalage horizontal, dans son canal vert le décalage vertical. Gris neutre
 * = aucun déplacement. `feDisplacementMap` lit cette carte et l'applique à
 * l'arrière-plan capté par `backdrop-filter`.
 *
 * Ces filtres se dégradent proprement : un navigateur qui refuse un filtre SVG
 * dans un `backdrop-filter` ignore la couche de réfraction, et le verre garde
 * son flou, sa teinte, son reflet et son élévation.
 */

interface LensSpec {
  id: string;
  /** Amplitude du déplacement au bord, en pixels. */
  scale: number;
  /**
   * Profil de la lentille : part de la surface qui reste plane au centre.
   * Plus la valeur est grande, plus la courbure se concentre sur le pourtour.
   */
  flat: number;
  /** Adoucit la carte : sans quoi la réfraction montre des cassures nettes. */
  blur: number;
}

const LENSES: LensSpec[] = [
  // Panneaux larges : bord fin par rapport à la surface, courbure serrée.
  { id: 'lg-lens-panel', scale: 40, flat: 0.6, blur: 0.7 },
  // Contrôles et pilules : le bord occupe proportionnellement plus de place.
  { id: 'lg-lens-control', scale: 24, flat: 0.4, blur: 0.55 },
  // Petits éléments : déplacement discret, sinon le contenu devient illisible.
  { id: 'lg-lens-chip', scale: 19, flat: 0.28, blur: 0.45 },
];

/**
 * Carte de déplacement d'un axe.
 *
 * Le profil suit une courbe de lentille : plat au centre, puis une montée de
 * plus en plus rapide vers le bord. Les arrêts intermédiaires ne sont pas
 * décoratifs — ce sont eux qui rendent la transition continue, et donc
 * invisible.
 */
function axisMap(flat: number, axis: 'x' | 'y'): string {
  const low = '#000000';
  const mid = axis === 'x' ? '#800000' : '#008000';
  const high = axis === 'x' ? '#ff0000' : '#00ff00';
  const direction = axis === 'x' ? 'x1="0" y1="0" x2="1" y2="0"' : 'x1="0" y1="0" x2="0" y2="1"';

  // Demi-largeur de la zone neutre, de part et d'autre du centre.
  const plateau = Math.min(0.46, flat / 2);

  // Deux arrêts intermédiaires de chaque côté suffisent à approcher la courbe :
  // en dessous, la montée redevient un palier visible.
  const stops = [
    { at: 0, color: low },
    { at: (0.5 - plateau) * 0.45, color: mixHex(low, mid, 0.55) },
    { at: (0.5 - plateau) * 0.8, color: mixHex(low, mid, 0.86) },
    { at: 0.5 - plateau, color: mid },
    { at: 0.5 + plateau, color: mid },
    { at: 1 - (0.5 - plateau) * 0.8, color: mixHex(high, mid, 0.86) },
    { at: 1 - (0.5 - plateau) * 0.45, color: mixHex(high, mid, 0.55) },
    { at: 1, color: high },
  ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260">`,
    `<defs><linearGradient id="g" ${direction}>`,
    ...stops.map((s) => `<stop offset="${s.at.toFixed(4)}" stop-color="${s.color}"/>`),
    `</linearGradient></defs>`,
    `<rect width="260" height="260" fill="url(#g)"/>`,
    `</svg>`,
  ].join('');
}

/** Mélange deux couleurs hexadécimales — `amount` = part de la seconde. */
function mixHex(from: string, to: string, amount: number): string {
  const parse = (hex: string): number[] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const a = parse(from);
  const b = parse(to);
  const channel = (index: number): string =>
    Math.round(a[index] + (b[index] - a[index]) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

const encode = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export function GlassFilters() {
  return (
    <svg className="glass-filters" aria-hidden="true" focusable="false">
      <defs>
        {LENSES.map((lens) => (
          <filter
            key={lens.id}
            id={lens.id}
            // Cadré sur la surface exacte : par défaut un filtre déborde de
            // 10 %, ce qui décalerait la réfraction par rapport au panneau.
            x="0"
            y="0"
            width="100%"
            height="100%"
            filterUnits="objectBoundingBox"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={encode(axisMap(lens.flat, 'x'))}
              preserveAspectRatio="none"
              x="0"
              y="0"
              width="100%"
              height="100%"
              result="mapX"
            />
            <feImage
              href={encode(axisMap(lens.flat, 'y'))}
              preserveAspectRatio="none"
              x="0"
              y="0"
              width="100%"
              height="100%"
              result="mapY"
            />
            {/* Le rouge de l'une et le vert de l'autre se réunissent en une
                seule carte : un décalage horizontal et un vertical. */}
            <feBlend in="mapX" in2="mapY" mode="screen" result="map" />
            <feGaussianBlur in="map" stdDeviation={lens.blur} result="lens" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="lens"
              scale={lens.scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
