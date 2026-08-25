import { useEffect, useState, type CSSProperties } from 'react';

export interface LoadingScreenProps {
  /** Passe à `true` dès que l'arbre est cadré et prêt à apparaître. */
  ready: boolean;
}

/**
 * Le rideau reste au moins cinq secondes à l'écran, même quand l'arbre est
 * prêt bien avant — un plancher voulu, pas seulement le temps de la
 * chorégraphie (~1,3 s). Si le chargement réel prenait plus longtemps que
 * ça, le rideau attendrait `ready` comme avant : ce n'est qu'une durée
 * minimale, choisie pour laisser la scène se dérouler en entier puis vivre
 * un moment avant de se refermer.
 */
const MIN_VISIBLE_MS = 5000;
const EXIT_MS = 720;

/** Un lien de filiation : sa forme (`d`) sert deux fois — au tracé du trait
 *  et au chemin que suit l'étincelle qui le parcourt ensuite en boucle. */
interface LinkSpec {
  id: string;
  d: string;
  delay: number;
  duration: number;
}

const LINKS: LinkSpec[] = [
  { id: 'l1', d: 'M100 168 L62 112', delay: 150, duration: 380 },
  { id: 'l2', d: 'M100 168 L138 112', delay: 150, duration: 380 },
  { id: 'l3', d: 'M62 112 L34 56', delay: 650, duration: 360 },
  { id: 'l4', d: 'M62 112 L86 56', delay: 690, duration: 360 },
  { id: 'l5', d: 'M138 112 L114 56', delay: 650, duration: 360 },
  { id: 'l6', d: 'M138 112 L166 56', delay: 690, duration: 360 },
];

interface NodeSpec {
  id: string;
  cx: number;
  cy: number;
  r: number;
  delay: number;
  gen: 0 | 1 | 2;
}

/**
 * Trois générations qui remontent depuis la racine — pas juste trois points :
 * une personne, ses deux parents, leurs quatre parents. La forme dit d'elle-
 * même ce que l'écran annonce, avant même que le texte ne se lise.
 */
const NODES: NodeSpec[] = [
  { id: 'root', cx: 100, cy: 168, r: 13, delay: 0, gen: 0 },
  { id: 'g1a', cx: 62, cy: 112, r: 11, delay: 500, gen: 1 },
  { id: 'g1b', cx: 138, cy: 112, r: 11, delay: 520, gen: 1 },
  { id: 'g2a', cx: 34, cy: 56, r: 8.5, delay: 990, gen: 2 },
  { id: 'g2b', cx: 86, cy: 56, r: 8.5, delay: 1040, gen: 2 },
  { id: 'g2c', cx: 114, cy: 56, r: 8.5, delay: 1090, gen: 2 },
  { id: 'g2d', cx: 166, cy: 56, r: 8.5, delay: 1140, gen: 2 },
];

/** Poussière ambiante : quelques grains qui dérivent lentement autour de la
 *  scène, comme le ciel étoilé / l'atlas du décor principal (voir
 *  `--motif-dot` dans `tokens.css`) — le rideau annonce déjà le monde
 *  qu'il s'apprête à découvrir. */
interface DustSpec {
  x: string;
  y: string;
  dx: string;
  dy: string;
  size: number;
  duration: number;
  delay: number;
}

const DUST: DustSpec[] = [
  { x: '18%', y: '30%', dx: '14px', dy: '-18px', size: 3, duration: 8200, delay: 0 },
  { x: '82%', y: '24%', dx: '-16px', dy: '-12px', size: 2.5, duration: 7400, delay: 900 },
  { x: '28%', y: '72%', dx: '10px', dy: '16px', size: 2, duration: 9000, delay: 1600 },
  { x: '74%', y: '68%', dx: '-12px', dy: '14px', size: 3, duration: 8600, delay: 400 },
  { x: '50%', y: '14%', dx: '8px', dy: '-14px', size: 2, duration: 7800, delay: 2000 },
  { x: '12%', y: '55%', dx: '12px', dy: '10px', size: 2.5, duration: 8000, delay: 1200 },
];

/**
 * Rideau d'ouverture.
 *
 * Entre le premier rendu et le cadrage initial de l'arbre (voir l'effet
 * d'ouverture dans `App`), l'écran serait sinon vide ou figé sur un plan
 * encore mal centré. Ce voile ne montre pas une roue de chargement
 * générique mais un arbre qui remonte trois générations et s'assemble sous
 * les yeux — racine, parents, grands-parents — pendant qu'un halo tourne
 * lentement derrière et que de petites étincelles parcourent les liens déjà
 * tracés, en boucle, jusqu'au départ.
 *
 * Reste monté un instant après le départ pour laisser le temps au rideau de
 * se refermer ; se démonte ensuite pour de bon.
 */
export function LoadingScreen({ ready }: LoadingScreenProps) {
  const [mounted, setMounted] = useState(true);
  const [floorPassed, setFloorPassed] = useState(false);

  useEffect(() => {
    // Le mouvement décoratif n'a rien à faire retarder pour qui l'a désactivé.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setFloorPassed(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setFloorPassed(true), MIN_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const leaving = ready && floorPassed;

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!mounted) return null;

  return (
    <div className="loading-screen" data-leaving={leaving || undefined} aria-hidden={leaving || undefined}>
      <div className="loading-screen__halo" />
      <div className="loading-screen__glow" />

      {DUST.map((dust, index) => (
        <span
          key={index}
          className="loading-screen__dust"
          style={
            {
              left: dust.x,
              top: dust.y,
              '--dx': dust.dx,
              '--dy': dust.dy,
              '--size': `${dust.size}px`,
              animationDuration: `${dust.duration}ms`,
              animationDelay: `${dust.delay}ms`,
            } as CSSProperties
          }
        />
      ))}

      <svg
        className="loading-screen__glyph"
        viewBox="0 0 200 190"
        role="img"
        aria-label="Arbre généalogique"
      >
        <defs>
          <linearGradient id="loading-screen-gradient" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-rose)" />
          </linearGradient>
          <radialGradient id="loading-screen-spark-gradient">
            <stop offset="0" stopColor="var(--accent-strong)" />
            <stop offset="1" stopColor="var(--accent-strong)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="loading-screen__links">
          {LINKS.map((link) => (
            <path
              key={link.id}
              className="loading-screen__link"
              pathLength={1}
              d={link.d}
              style={
                {
                  animationDelay: `${link.delay}ms`,
                  animationDuration: `${link.duration}ms`,
                } as CSSProperties
              }
            />
          ))}
        </g>

        {/* Étincelles : mêmes tracés que les liens, parcourus en boucle une
            fois le trait dessiné — voir `offset-path` dans le CSS. */}
        <g className="loading-screen__sparks">
          {LINKS.map((link) => (
            <circle
              key={link.id}
              className="loading-screen__spark"
              r="2.6"
              style={
                {
                  offsetPath: `path("${link.d}")`,
                  animationDelay: `${link.delay + link.duration + 120}ms`,
                } as CSSProperties
              }
            />
          ))}
        </g>

        <g className="loading-screen__nodes">
          {NODES.map((node) => (
            <circle
              key={node.id}
              className="loading-screen__node"
              data-gen={node.gen}
              cx={node.cx}
              cy={node.cy}
              r={node.r}
              style={
                {
                  animationDelay: `${node.delay}ms, ${node.delay + 700 + node.gen * 90}ms`,
                } as CSSProperties
              }
            />
          ))}
        </g>
      </svg>

      <p className="loading-screen__label">
        On rassemble la famille
        <span className="loading-screen__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </p>
    </div>
  );
}
