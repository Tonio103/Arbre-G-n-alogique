/**
 * Filtres de réfraction du matériau de verre.
 *
 * Ce que le CSS seul ne sait pas faire : courber ce qui se trouve derrière la
 * surface. Un panneau de verre réel n'est pas un simple flou — ses bords se
 * comportent comme une lentille et étirent l'arrière-plan. C'est ce déplacement
 * de bord qui distingue une vraie épaisseur de verre d'un rectangle translucide.
 *
 * Principe : une carte de déplacement encode dans le canal rouge le décalage
 * horizontal et dans le canal vert le décalage vertical. Gris neutre au centre
 * (aucun déplacement), valeurs extrêmes sur les bords (déplacement maximal).
 * `feDisplacementMap` applique cette carte à l'arrière-plan capté par
 * `backdrop-filter`.
 *
 * Ces filtres se dégradent proprement : un navigateur qui ne sait pas appliquer
 * un filtre SVG dans un `backdrop-filter` ignore la couche de réfraction, et le
 * verre garde son flou, sa teinte et son arête lumineuse.
 */

interface LensSpec {
  id: string;
  /** Largeur de la zone réfractante, en fraction de la surface (0 → 0,5). */
  edge: number;
  /** Amplitude du déplacement, en pixels. */
  scale: number;
  /** Adoucit la carte : sans quoi la réfraction montre des cassures nettes. */
  blur: number;
}

const LENSES: LensSpec[] = [
  // Panneaux larges : bord fin, réfraction franche.
  { id: 'lg-lens-panel', edge: 0.055, scale: 46, blur: 0.6 },
  // Contrôles et pilules : le bord occupe proportionnellement plus de place.
  { id: 'lg-lens-control', edge: 0.16, scale: 26, blur: 0.5 },
  // Petits éléments : déplacement discret, sinon le contenu devient illisible.
  { id: 'lg-lens-chip', edge: 0.24, scale: 15, blur: 0.4 },
];

/**
 * Carte de déplacement d'un axe.
 * Le dégradé reste neutre sur toute la partie centrale et ne bascule que dans
 * la bande de bord, ce qui laisse le cœur du panneau parfaitement net.
 */
function axisMap(edge: number, axis: 'x' | 'y'): string {
  const low = axis === 'x' ? '#000000' : '#000000';
  const mid = axis === 'x' ? '#800000' : '#008000';
  const high = axis === 'x' ? '#ff0000' : '#00ff00';
  const direction = axis === 'x' ? 'x1="0" y1="0" x2="1" y2="0"' : 'x1="0" y1="0" x2="0" y2="1"';
  const inner = Math.min(0.49, edge).toFixed(3);
  const outer = (1 - Math.min(0.49, edge)).toFixed(3);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">`,
    `<defs><linearGradient id="g" ${direction}>`,
    `<stop offset="0" stop-color="${low}"/>`,
    `<stop offset="${inner}" stop-color="${mid}"/>`,
    `<stop offset="${outer}" stop-color="${mid}"/>`,
    `<stop offset="1" stop-color="${high}"/>`,
    `</linearGradient></defs>`,
    `<rect width="240" height="240" fill="url(#g)"/>`,
    `</svg>`,
  ].join('');
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
            // Cadré sur la surface exacte : par défaut un filtre déborde de 10 %,
            // ce qui décalerait la réfraction par rapport au bord du panneau.
            x="0"
            y="0"
            width="100%"
            height="100%"
            filterUnits="objectBoundingBox"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={encode(axisMap(lens.edge, 'x'))}
              preserveAspectRatio="none"
              x="0"
              y="0"
              width="100%"
              height="100%"
              result="mapX"
            />
            <feImage
              href={encode(axisMap(lens.edge, 'y'))}
              preserveAspectRatio="none"
              x="0"
              y="0"
              width="100%"
              height="100%"
              result="mapY"
            />
            {/* Le rouge de l'un et le vert de l'autre se réunissent en une seule
                carte : un déplacement horizontal et un vertical. */}
            <feBlend in="mapX" in2="mapY" mode="screen" result="map" />
            <feGaussianBlur in="map" stdDeviation={lens.blur} result="softMap" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="softMap"
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
