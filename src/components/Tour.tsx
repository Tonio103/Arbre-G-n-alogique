import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { rememberTourSeen } from './tour-state';

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

const SceneHub = () => (
  <svg viewBox="0 0 260 150" className="tour-scene-svg" aria-hidden="true">
    {/* Un couple affiché : le point se pose ENTRE les deux. */}
    <circle className="tour-dot" cx="62" cy="52" r="14" />
    <circle className="tour-dot" cx="112" cy="52" r="14" />
    <line className="tour-link" x1="62" y1="52" x2="112" y2="52" />
    <circle className="tour-hub" cx="87" cy="52" r="3.4" />
    <text x="87" y="86" className="tour-caption-svg">entre deux : un couple</text>

    {/* Un conjoint absent : le point passe SOUS la carte. */}
    <circle className="tour-dot" cx="196" cy="52" r="14" />
    <circle className="tour-hub tour-hub--under" cx="196" cy="72" r="3.4" />
    <text x="196" y="86" className="tour-caption-svg">dessous : union cachée</text>

    <text x="130" y="126" className="tour-caption-svg">
      un point sous quelqu’un = il y a plus à voir
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
    title: 'Les petits points sur les traits',
    body: (
      <>
        Un point <strong>entre deux personnes</strong> marque leur union. Un point{' '}
        <strong>sous une seule personne</strong> veut dire autre chose : elle a une union que{' '}
        <em>cette vue ne montre pas</em> — son conjoint n’est pas affiché ici. Le plus souvent,
        toute une descendance se cache derrière. Ouvrez sa fiche et{' '}
        <strong>« Repartir d’ici »</strong> pour la déplier.
      </>
    ),
    scene: <SceneHub />,
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
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const finish = useCallback(() => {
    rememberTourSeen();
    onClose();
  }, [onClose]);

  // Ouvrir remet au début : rouvrir le guide pour revoir une étape ne doit pas
  // reprendre là où on l'avait laissé six semaines plus tôt.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  /*
   * Retenir le focus dans le guide.
   *
   * Il s'annonçait `aria-modal="true"` sans l'être : vingt-cinq boutons
   * restaient atteignables à la tabulation DERRIÈRE lui, et le focus ne
   * quittait même pas le corps du document à l'ouverture. L'attribut mentait
   * sur ce que faisait le code ; au clavier, on se retrouvait à piloter
   * l'arbre caché sous la modale.
   *
   * Le focus revient ensuite d'où il venait — le bouton « ? » —, pour ne pas
   * repartir du début de la page.
   */
  /*
   * Retenir, puis rendre le focus. Deux effets, et pas un seul.
   *
   * Tout mettre dans l'effet clavier le faisait dépendre de `finish`, dont
   * l'identité change à chaque rendu de `App` (le `onClose` y est une fonction
   * créée à la volée). L'effet se démontait et se remontait sans arrêt : le
   * focus était « rendu » des dizaines de fois, et `returnTo` finissait par
   * pointer sur le guide lui-même plutôt que sur le bouton d'où l'on venait.
   * Celui-ci ne dépend que de l'ouverture.
   */
  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLElement>('.tour-next')?.focus();
    return () => returnTo.current?.focus?.();
  }, [open]);

  // `finish` passe par une référence : le gestionnaire clavier n'a pas à être
  // reposé chaque fois que `App` se redessine.
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        finishRef.current();
        return;
      }
      if (event.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (event.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
      if (event.key !== 'Tab') return;

      const card = cardRef.current;
      if (!card) return;
      const stops = [
        ...card.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => el.offsetParent !== null);
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!card.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Comment lire l’arbre">
      <div className="tour-veil" onClick={finish} />

      <div className="tour-card lg lg--thick" ref={cardRef}>
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
