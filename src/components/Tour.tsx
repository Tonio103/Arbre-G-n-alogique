import { useCallback, useEffect, useState, type ReactNode } from 'react';

/*
 * ============================================================================
 *
 *  LE GUIDE
 *
 *  Un arbre d'ascendance ne se devine pas : on ne sait pas d'emblée que la
 *  rangée du bas est soi, que chaque rangée du dessus double la précédente,
 *  ni qu'un clic ouvre une fiche sans déplacer l'arbre.
 *
 *  Chaque étape MONTRE le geste plutôt que de le décrire : une petite scène
 *  animée accompagne le texte. On retient un mouvement qu'on a vu ; on oublie
 *  une phrase qui l'explique.
 *
 *  Il s'ouvre tout seul à la première visite, et se rouvre ensuite par le
 *  bouton « ? » de la barre du haut — jamais imposé deux fois.
 *
 * ==========================================================================*/

const SEEN_KEY = 'arbre:guide-vu';

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Navigation privée, stockage refusé : on considère le guide comme vu
    // plutôt que de le réafficher à chaque ouverture.
    return true;
  }
}

function rememberSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* voir `hasSeenTour` */
  }
}

interface Step {
  title: string;
  body: ReactNode;
  scene: ReactNode;
}

/* ── Les petites scènes ─────────────────────────────────────────────────────
 *
 * Dessinées en SVG aux mêmes teintes que l'arbre, pour qu'on reconnaisse ce
 * dont on parle. Elles bouclent : l'étape reste consultable le temps qu'on
 * veut, et le geste se rejoue jusqu'à ce qu'on l'ait saisi.
 */

const SceneShape = () => (
  <svg viewBox="0 0 260 150" className="tour-scene-svg" aria-hidden="true">
    {[
      { y: 26, n: 4, r: 5 },
      { y: 68, n: 2, r: 7 },
      { y: 112, n: 1, r: 9 },
    ].map((row, gen) =>
      Array.from({ length: row.n }, (_, i) => {
        const gap = 260 / (row.n + 1);
        const x = gap * (i + 1);
        return (
          <g key={`${gen}-${i}`}>
            {gen < 2 && (
              <line
                className="tour-link"
                x1={x}
                y1={row.y}
                x2={(260 / (row.n / 2 + 1)) * (Math.floor(i / 2) + 1)}
                y2={row.y + 42}
              />
            )}
            <circle
              className="tour-dot"
              data-self={gen === 2 || undefined}
              cx={x}
              cy={row.y}
              r={row.r}
              style={{ animationDelay: `${(2 - gen) * 260}ms` }}
            />
          </g>
        );
      }),
    )}
    <text x="130" y="140" className="tour-caption-svg">
      vous, en bas — vos aïeux au-dessus
    </text>
  </svg>
);

const SceneClick = () => (
  <svg viewBox="0 0 260 150" className="tour-scene-svg" aria-hidden="true">
    <circle className="tour-dot" cx="90" cy="62" r="15" />
    <circle className="tour-dot" cx="170" cy="62" r="15" />
    <rect className="tour-panel" x="150" y="26" width="86" height="100" rx="10" />
    <circle className="tour-pointer" cx="90" cy="62" r="7" />
    <text x="130" y="142" className="tour-caption-svg">
      un clic ouvre la fiche — l’arbre ne bouge pas
    </text>
  </svg>
);

const SceneDrag = () => (
  <svg viewBox="0 0 260 150" className="tour-scene-svg" aria-hidden="true">
    <g className="tour-pan">
      <circle className="tour-dot" cx="60" cy="48" r="9" />
      <circle className="tour-dot" cx="130" cy="48" r="9" />
      <circle className="tour-dot" cx="200" cy="48" r="9" />
      <circle className="tour-dot" cx="95" cy="96" r="9" />
      <circle className="tour-dot" cx="165" cy="96" r="9" />
    </g>
    <path className="tour-arrow" d="M70 130 H190" markerEnd="url(#tour-tip)" />
    <defs>
      <marker id="tour-tip" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
        <path d="M0 0 L7 3.5 L0 7 z" fill="var(--accent)" />
      </marker>
    </defs>
    <text x="130" y="146" className="tour-caption-svg">
      glissez pour vous déplacer, molette pour zoomer
    </text>
  </svg>
);

const SceneViews = () => (
  <svg viewBox="0 0 260 150" className="tour-scene-svg" aria-hidden="true">
    {['Arbre', 'Carte', 'Chrono', 'Manques'].map((label, i) => (
      <g key={label}>
        <rect
          className="tour-tab"
          data-active={i === 0 || undefined}
          x={12 + i * 60}
          y={40}
          width={54}
          height={26}
          rx={9}
          style={{ animationDelay: `${i * 700}ms` }}
        />
        <text x={39 + i * 60} y={57} className="tour-tab-label">
          {label}
        </text>
      </g>
    ))}
    <text x="130" y="112" className="tour-caption-svg">
      les autres vues suivent la branche affichée
    </text>
  </svg>
);

const SceneEdit = () => (
  <svg viewBox="0 0 260 150" className="tour-scene-svg" aria-hidden="true">
    <circle className="tour-dot" cx="70" cy="70" r="16" />
    <circle className="tour-dot tour-dot--new" cx="170" cy="42" r="12" />
    <circle className="tour-dot tour-dot--new" cx="170" cy="100" r="12" />
    <line className="tour-link tour-link--new" x1="86" y1="66" x2="158" y2="46" />
    <line className="tour-link tour-link--new" x1="86" y1="76" x2="158" y2="96" />
    <text x="130" y="138" className="tour-caption-svg">
      « Ajouter un proche » fait pousser la branche
    </text>
  </svg>
);

const STEPS: Step[] = [
  {
    title: 'L’arbre se lit de bas en haut',
    body: (
      <>
        Tout en bas, <strong>vous et votre fratrie</strong>. Juste au-dessus, vos parents. Puis vos
        grands-parents, et ainsi de suite : <strong>chaque rangée double la précédente</strong>.
        Deux parents, quatre grands-parents, huit arrière-grands-parents.
      </>
    ),
    scene: <SceneShape />,
  },
  {
    title: 'Cliquer ouvre une fiche',
    body: (
      <>
        Un clic sur quelqu’un ouvre sa fiche à droite : dates, lieux, métier, parenté.{' '}
        <strong>L’arbre ne se réorganise pas</strong> — vous gardez sous les yeux la famille que
        vous étiez en train de regarder.
      </>
    ),
    scene: <SceneClick />,
  },
  {
    title: 'Se déplacer, zoomer',
    body: (
      <>
        <strong>Glissez</strong> pour vous promener, <strong>molette</strong> ou pincement pour
        zoomer. Le bouton maison ramène à vous, et celui d’à côté recadre l’arbre entier. La
        recherche en haut trouve n’importe qui par son nom.
      </>
    ),
    scene: <SceneDrag />,
  },
  {
    title: 'Quatre façons de regarder',
    body: (
      <>
        <strong>Carte</strong> pour les lieux, <strong>Chronologie</strong> pour voir qui a vécu en
        même temps, <strong>À compléter</strong> pour ce qui manque encore. Les trois suivent la
        branche affichée — et un sélecteur permet de passer au côté paternel, maternel, ou à toute
        la famille.
      </>
    ),
    scene: <SceneViews />,
  },
  {
    title: 'Faire grandir l’arbre',
    body: (
      <>
        Dans une fiche, <strong>Modifier</strong> corrige les informations et{' '}
        <strong>Ajouter un proche</strong> rattache un parent, un conjoint ou un enfant — soit
        quelqu’un de nouveau, soit une personne déjà présente. Tout est enregistré aussitôt.
      </>
    ),
    scene: <SceneEdit />,
  },
];

export interface TourProps {
  open: boolean;
  onClose: () => void;
}

export function Tour({ open, onClose }: TourProps) {
  const [step, setStep] = useState(0);

  const finish = useCallback(() => {
    rememberSeen();
    onClose();
  }, [onClose]);

  // Ouvrir remet au début : rouvrir le guide pour revoir une étape ne doit pas
  // reprendre là où on l'avait laissé six semaines plus tôt.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish();
      if (event.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (event.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!open) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Comment lire l’arbre">
      <div className="tour-veil" onClick={finish} />

      <div className="tour-card lg lg--thick">
        <div className="tour-scene">{current.scene}</div>

        <div className="tour-body">
          <p className="tour-step">
            Étape {step + 1} sur {STEPS.length}
          </p>
          <h2 className="tour-title">{current.title}</h2>
          <p className="tour-text">{current.body}</p>
        </div>

        <div className="tour-foot">
          <div className="tour-dots" role="tablist" aria-label="Étapes">
            {STEPS.map((s, index) => (
              <button
                key={s.title}
                type="button"
                className="tour-bullet"
                data-active={index === step || undefined}
                aria-label={`Étape ${index + 1} : ${s.title}`}
                aria-selected={index === step}
                role="tab"
                onClick={() => setStep(index)}
              />
            ))}
          </div>

          <div className="tour-actions">
            <button type="button" className="tour-skip" onClick={finish}>
              {last ? 'Fermer' : 'Passer'}
            </button>
            {step > 0 && (
              <button type="button" className="tour-back" onClick={() => setStep(step - 1)}>
                Précédent
              </button>
            )}
            <button
              type="button"
              className="tour-next"
              onClick={() => (last ? finish() : setStep(step + 1))}
            >
              {last ? 'Commencer' : 'Suivant'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
