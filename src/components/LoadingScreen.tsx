import { useEffect, useState, type CSSProperties } from 'react';

export interface LoadingScreenProps {
  /** Passe à `true` dès que l'arbre est cadré et prêt à apparaître. */
  ready: boolean;
}

/**
 * Le rideau reste au moins cinq secondes à l'écran, même quand l'arbre est
 * prêt bien avant — un plancher voulu, pas seulement le temps du tracé du
 * glyphe (~1,2 s). Si le chargement réel prenait plus longtemps que ça, le
 * rideau attendrait `ready` comme avant : ce n'est qu'une durée minimale.
 */
const MIN_VISIBLE_MS = 5000;
const EXIT_MS = 720;

/**
 * Rideau d'ouverture.
 *
 * Entre le premier rendu et le cadrage initial de l'arbre (voir l'effet
 * d'ouverture dans `App`), l'écran serait sinon vide ou figé sur un plan
 * encore mal centré. Ce voile reprend le glyphe du favicon — trois
 * personnes, deux générations — et l'anime comme une filiation qui se
 * dessine, plutôt que d'afficher une simple roue de chargement générique.
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

  const nodes: Array<{ cx: number; cy: number; delay: number }> = [
    { cx: 60, cy: 34, delay: 0 },
    { cx: 34, cy: 84, delay: 1 },
    { cx: 86, cy: 84, delay: 2 },
  ];

  return (
    <div className="loading-screen" data-leaving={leaving || undefined} aria-hidden={leaving || undefined}>
      <div className="loading-screen__glow" />
      <svg
        className="loading-screen__glyph"
        viewBox="0 0 120 120"
        role="img"
        aria-label="Arbre généalogique"
      >
        <defs>
          <linearGradient id="loading-screen-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-rose)" />
          </linearGradient>
        </defs>
        <g className="loading-screen__links">
          <path className="loading-screen__link" pathLength={1} d="M60 34 L34 84" style={{ '--delay': '0.28s' } as CSSProperties} />
          <path className="loading-screen__link" pathLength={1} d="M60 34 L86 84" style={{ '--delay': '0.42s' } as CSSProperties} />
          <path className="loading-screen__link" pathLength={1} d="M34 84 L86 84" style={{ '--delay': '0.56s' } as CSSProperties} />
        </g>
        <g className="loading-screen__nodes">
          {nodes.map((node) => (
            <circle
              key={`${node.cx}-${node.cy}`}
              className="loading-screen__node"
              cx={node.cx}
              cy={node.cy}
              r="11"
              style={{ '--i': node.delay } as CSSProperties}
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
