import { useEffect, useMemo, useState, type CSSProperties } from 'react';

export interface LoadingScreenProps {
  /** Passe à `true` dès que l'arbre est cadré et prêt à apparaître. */
  ready: boolean;
  /** Nom de la famille, tel qu'il est saisi dans les données. */
  title?: string;
  /** Quelques noms réels, du plus ancien au plus récent. */
  names?: string[];
  /** Nombre de personnes dans l'arbre. */
  people?: number;
  /** Nombre de générations couvertes. */
  generations?: number;
}

/*
 * Combien de temps le rideau reste, au minimum.
 *
 * La première visite mérite la chorégraphie entière : on découvre l'arbre,
 * l'éventail s'allume génération par génération, les noms défilent. Les
 * suivantes, non — mesuré sur cette application, la page est prête en 179 ms
 * et le plancher en imposait 5 200 : cinq secondes d'attente pure, à chaque
 * ouverture. Grandiose la première fois, pénible la trentième.
 *
 * On garde donc la scène complète une seule fois, puis on se contente de
 * couvrir le temps réel du chargement.
 */
const FIRST_VISIT_MS = 5200;
const RETURNING_MS = 900;
const EXIT_MS = 900;

const SEEN_KEY = 'arbre:ouverture-vue';

function isReturning(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Stockage refusé : on traite comme un retour, pour ne pas infliger la
    // scène longue à chaque fois sans pouvoir s'en souvenir.
    return true;
  }
}

/* ── Géométrie de l'éventail ────────────────────────────────────────────────
 *
 * Une ascendance ne se dessine pas comme un buisson : elle DOUBLE à chaque
 * génération — une personne, deux parents, quatre grands-parents, huit
 * arrière-grands-parents. L'éventail est la seule forme qui rende cette
 * progression évidente à l'œil, et c'est exactement ce que l'application
 * dessine une fois chargée. Le rideau annonce donc l'arbre, il ne l'illustre
 * pas vaguement.
 */

const VIEW_W = 560;
const VIEW_H = 340;
const CX = 280;
const CY = 312;
/** Ouverture de l'éventail, en degrés de part et d'autre de la verticale. */
const SPREAD = 74;
const RINGS = 5;
const RADIUS = (gen: number): number => 34 + gen * 62;

interface FanNode {
  id: string;
  gen: number;
  index: number;
  x: number;
  y: number;
  r: number;
  /** Instant d'allumage, en millisecondes depuis l'ouverture. */
  at: number;
}

interface FanLink {
  id: string;
  d: string;
  at: number;
  length: number;
}

function buildFan(): { nodes: FanNode[]; links: FanLink[]; span: number } {
  const nodes: FanNode[] = [];
  const links: FanLink[] = [];
  const byGen: FanNode[][] = [];

  // Chaque génération s'allume après la précédente, et un peu plus vite :
  // le rythme s'accélère à mesure que l'arbre s'élargit, comme une inspiration.
  const genStart = (gen: number): number => gen * 620 - gen * gen * 22;

  for (let gen = 0; gen < RINGS; gen += 1) {
    const count = 2 ** gen;
    const radius = RADIUS(gen);
    const row: FanNode[] = [];

    for (let index = 0; index < count; index += 1) {
      // Réparti au centre de sa part d'arc : l'éventail reste symétrique
      // quelle que soit la génération.
      const t = count === 1 ? 0.5 : (index + 0.5) / count;
      const angle = ((-SPREAD + t * SPREAD * 2) * Math.PI) / 180;
      const node: FanNode = {
        id: `n${gen}-${index}`,
        gen,
        index,
        x: CX + radius * Math.sin(angle),
        y: CY - radius * Math.cos(angle),
        r: Math.max(3.2, 13 - gen * 2.1),
        // Les nœuds d'une même génération s'allument du centre vers les bords.
        at: genStart(gen) + Math.abs(t - 0.5) * 460,
      };
      row.push(node);
      nodes.push(node);
    }

    if (gen > 0) {
      const parents = byGen[gen - 1];
      for (const node of row) {
        const child = parents[node.index >> 1];
        const dx = node.x - child.x;
        const dy = node.y - child.y;
        links.push({
          id: `l${node.id}`,
          // Une courbe douce plutôt qu'un segment : l'éventail respire, et le
          // trait suit le mouvement du regard qui remonte une lignée.
          d: `M${child.x.toFixed(1)},${child.y.toFixed(1)} Q${(child.x + dx * 0.5).toFixed(1)},${(
            child.y +
            dy * 0.62
          ).toFixed(1)} ${node.x.toFixed(1)},${node.y.toFixed(1)}`,
          at: node.at - 300,
          length: Math.hypot(dx, dy) * 1.08,
        });
      }
    }

    byGen.push(row);
  }

  const span = Math.max(...nodes.map((node) => node.at)) + 900;
  return { nodes, links, span };
}

const FAN = buildFan();

/** Poussière ambiante, dans l'esprit du fond étoilé de l'application. */
const DUST = Array.from({ length: 14 }, (_, index) => {
  const seed = (index * 2654435761) % 1000;
  return {
    x: `${6 + ((seed * 7) % 88)}%`,
    y: `${8 + ((seed * 13) % 80)}%`,
    dx: `${((seed % 30) - 15).toFixed(0)}px`,
    dy: `${-8 - (seed % 22)}px`,
    size: 1.6 + (seed % 22) / 10,
    duration: 7000 + (seed % 40) * 120,
    delay: (seed % 30) * 90,
  };
});

/**
 * Rideau d'ouverture.
 *
 * Un éventail d'ascendance s'allume de proche en proche : la personne, ses
 * deux parents, leurs quatre parents, et ainsi de suite — chaque génération
 * doublant la précédente. Les traits se tracent avant les médaillons, comme
 * une lignée qu'on remonte, et une étincelle parcourt ensuite chaque lien.
 *
 * Les noms qui défilent sont ceux de la vraie famille chargée, pas un décor :
 * l'écran d'attente montre déjà ce qu'on est venu voir.
 */
export function LoadingScreen({
  ready,
  title,
  names = [],
  people = 0,
  generations = 0,
}: LoadingScreenProps) {
  const [mounted, setMounted] = useState(true);
  const [floorPassed, setFloorPassed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [nameIndex, setNameIndex] = useState(0);

  useEffect(() => {
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduced(quiet);
    // Le mouvement décoratif n'a rien à faire attendre qui l'a désactivé.
    if (quiet) {
      setFloorPassed(true);
      return undefined;
    }
    const floor = isReturning() ? RETURNING_MS : FIRST_VISIT_MS;
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* voir `isReturning` */
    }
    const timer = window.setTimeout(() => setFloorPassed(true), floor);
    return () => window.clearTimeout(timer);
  }, []);

  // Les noms se relaient pendant que l'éventail se remplit.
  useEffect(() => {
    if (reduced || names.length < 2) return undefined;
    const timer = window.setInterval(
      () => setNameIndex((index) => (index + 1) % names.length),
      1150,
    );
    return () => window.clearInterval(timer);
  }, [reduced, names.length]);

  const leaving = ready && floorPassed;

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const caption = useMemo(() => {
    if (people === 0) return 'Assemblage de l’arbre';
    const gen = generations > 0 ? `${generations} générations` : '';
    return [`${people} personnes`, gen].filter(Boolean).join(' · ');
  }, [people, generations]);

  if (!mounted) return null;

  return (
    <div
      className="loading-screen"
      data-leaving={leaving || undefined}
      data-reduced={reduced || undefined}
      aria-hidden={leaving || undefined}
      role="status"
      aria-live="polite"
    >
      {/* Le fond : une aurore lente, puis un halo qui pulse au rythme des
          générations qui s'allument. */}
      <div className="ls-aurora" />
      <div className="ls-halo" />
      <div className="ls-vignette" />

      {DUST.map((dust, index) => (
        <span
          key={index}
          className="ls-dust"
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

      <div className="ls-stage">
        <svg
          className="ls-fan"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label="Un arbre d’ascendance qui s’assemble"
        >
          <defs>
            <radialGradient id="ls-node" cx="35%" cy="30%">
              <stop offset="0%" stopColor="var(--ls-node-hi)" />
              <stop offset="100%" stopColor="var(--ls-node-lo)" />
            </radialGradient>
            <filter id="ls-soft" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>

          {/* Les arcs de génération : un repère discret qui dit que chaque
              rangée est un âge de la famille. */}
          {Array.from({ length: RINGS }, (_, gen) => {
            const radius = RADIUS(gen);
            const a = (SPREAD * Math.PI) / 180;
            const x1 = CX - radius * Math.sin(a);
            const y1 = CY - radius * Math.cos(a);
            const x2 = CX + radius * Math.sin(a);
            return (
              <path
                key={`ring${gen}`}
                className="ls-ring"
                d={`M${x1.toFixed(1)},${y1.toFixed(1)} A${radius},${radius} 0 0 1 ${x2.toFixed(
                  1,
                )},${y1.toFixed(1)}`}
                style={{ animationDelay: `${gen * 560}ms` }}
              />
            );
          })}

          {FAN.links.map((link) => (
            <g key={link.id}>
              <path
                className="ls-link"
                d={link.d}
                style={
                  {
                    '--len': link.length,
                    animationDelay: `${link.at}ms`,
                  } as CSSProperties
                }
              />
              {/* L'étincelle qui remonte le lien, une fois celui-ci tracé. */}
              <circle className="ls-spark" r="2.1">
                <animateMotion
                  dur="1.9s"
                  begin={`${(link.at + 420) / 1000}s`}
                  repeatCount="indefinite"
                  path={link.d}
                  keyPoints="0;1"
                  keyTimes="0;1"
                  calcMode="spline"
                  keySplines="0.4 0 0.2 1"
                />
              </circle>
            </g>
          ))}

          {FAN.nodes.map((node) => (
            <g
              key={node.id}
              className="ls-node"
              data-gen={node.gen}
              style={{ animationDelay: `${node.at}ms` }}
            >
              <circle
                className="ls-node-glow"
                cx={node.x}
                cy={node.y}
                r={node.r * 2.1}
                filter="url(#ls-soft)"
              />
              <circle className="ls-node-ring" cx={node.x} cy={node.y} r={node.r + 3.5} />
              <circle className="ls-node-dot" cx={node.x} cy={node.y} r={node.r} />
            </g>
          ))}
        </svg>

        <div className="ls-titles">
          <h1 className="ls-title">{title || 'Arbre généalogique'}</h1>

          <div className="ls-names" aria-hidden="true">
            {names.length > 0 ? (
              names.map((name, index) => (
                <span
                  key={name + index}
                  className="ls-name"
                  data-active={index === nameIndex || undefined}
                >
                  {name}
                </span>
              ))
            ) : (
              <span className="ls-name" data-active>
                Une génération après l’autre
              </span>
            )}
          </div>

          <p className="ls-caption">{caption}</p>

          <div className="ls-progress" aria-hidden="true">
            <span className="ls-progress-fill" />
          </div>
        </div>
      </div>
    </div>
  );
}
