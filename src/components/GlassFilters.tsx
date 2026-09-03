/**
 * L'optique du verre.
 *
 * Le CSS sait flouter, teinter, éclairer une arête. Il ne sait pas **courber**
 * ce qui se trouve derrière une surface — or c'est exactement ce qui distingue
 * une plaque de verre d'un rectangle translucide.
 *
 * La première version de ce fichier construisait une carte de déplacement sur
 * mesure — plate au centre, courbe sur le pourtour — et l'injectait via
 * `feImage` référençant un dégradé encodé en URI de données. Elle ne
 * produisait strictement aucun effet : Chromium ignore silencieusement tout
 * `feImage` chargeant une ressource (URI de données ou même une simple
 * référence locale) à l'intérieur d'un filtre appliqué par `backdrop-filter`
 * — une restriction de sécurité, l'arrière-plan capté pouvant appartenir à
 * une autre origine. Aucune erreur, aucun avertissement : le filtre
 * s'exécute, `feDisplacementMap` reçoit une carte vide, et la « lentille »
 * ne déplaçait jamais rien. Vérifié par un cas minimal isolé (un simple
 * dégradé, sans rapport avec ce fichier) avant de conclure.
 *
 * `feTurbulence`, elle, ne charge aucune ressource : elle calcule son bruit
 * entièrement à l'intérieur du graphe de filtre, et fonctionne donc à travers
 * `backdrop-filter`. C'est elle qui porte la réfraction ici — un
 * clapotis léger plutôt qu'une courbure de lentille précise, mais un
 * clapotis qui existe réellement à l'écran, ce que l'ancienne version ne
 * pouvait pas dire. Comme le bruit ne connaît pas la forme du panneau qui le
 * porte, il n'a par construction aucun des artefacts qu'avait l'ancienne
 * lentille sur les formes très allongées (barre supérieure, rail) : nul
 * besoin d'y renoncer sur ces éléments-là.
 *
 * La dispersion chromatique (la frange colorée qu'un verre épais laisse sur
 * ses bords) reste hors de portée d'un filtre SVG : recomposer trois canaux
 * séparément décalés perd sa luminosité en alpha prémultiplié et laisse des
 * franges cyan au lieu d'un liseré discret. Elle est donc portée par l'arête
 * spéculaire, en CSS, où elle reste sous contrôle.
 *
 * Ces filtres se dégradent proprement : un navigateur qui refuse un filtre
 * SVG dans un `backdrop-filter` ignore la couche de réfraction, et le verre
 * garde son flou, sa teinte, son reflet et son élévation.
 */

interface LensSpec {
  id: string;
  /** Amplitude du déplacement, en pixels — l'ampleur du clapotis. */
  scale: number;
  /** Fréquence du bruit : plus petite, plus les vagues sont larges. */
  frequency: number;
}

const LENSES: LensSpec[] = [
  // Grands panneaux (fiche, barre du haut) : des vagues amples, qui se
  // lisent comme une surface plutôt qu'une texture.
  { id: 'lg-lens-panel', scale: 15, frequency: 0.009 },
  // Contrôles et pilules de taille moyenne.
  { id: 'lg-lens-control', scale: 11, frequency: 0.013 },
  // Petits éléments : le clapotis reste net, la surface étant petite.
  { id: 'lg-lens-chip', scale: 7, frequency: 0.017 },
  // Barres très allongées (barre supérieure, rail, pilules larges) : l'axe
  // court y est étroit, l'amplitude reste donc un peu plus mesurée.
  { id: 'lg-lens-bar', scale: 8, frequency: 0.012 },
];

export function GlassFilters() {
  return (
    <svg className="glass-filters" aria-hidden="true" focusable="false">
      <defs>
        {/*
         * Fusion.
         *
         * Deux surfaces de verre qui s'approchent ne se chevauchent pas comme
         * deux cartes : elles se rejoignent par un pont, à la manière de deux
         * gouttes qui se touchent. C'est ce comportement, plus que la
         * transparence, qui fait dire d'une interface qu'elle est liquide.
         *
         * Le procédé : flouter le groupe, puis durcir brutalement l'alpha. Les
         * halos de deux formes voisines se recouvrent, et ce recouvrement
         * repasse au-dessus du seuil — un col de matière apparaît entre elles.
         * Le contraste ramène ensuite les bords à leur netteté.
         */}
        <filter id="lg-merge" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="soft" />
          <feColorMatrix
            in="soft"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
            result="sharp"
          />
          <feComposite in="SourceGraphic" in2="sharp" operator="atop" />
        </filter>
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
            {/* Bruit fixe (graine constante) : un clapotis immobile tant que
                le fond derrière ne bouge pas, pas une animation. */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency={lens.frequency}
              numOctaves={2}
              seed={7}
              result="ripple"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="ripple"
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
