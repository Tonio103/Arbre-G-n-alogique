import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { TreeLayout } from '@/domain/layout';
import { acteA, buildScenario, debutDe, type Acte } from '@/domain/film';
import type { ViewportController } from '@/view/viewport';
import { CARD_HEIGHT, CARD_WIDTH, ROW_HEIGHT } from '@/view/metrics';
import { cadrePourLieux, urlTuile, type Cadre } from '@/view/tuiles';

export interface FilmViewProps {
  graph: FamilyGraph;
  layout: TreeLayout;
  viewport: ViewportController;
  gapCount: number;
  onClose: () => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LE FILM
 *
 * Une famille racontée en une minute, sur sa propre planche.
 *
 * ── CE QUE CE COMPOSANT EST, ET N'EST PAS ────────────────────────────────
 *
 * Il ne dessine ni arbre, ni encre, ni médaillon. L'arbre est là, sous lui,
 * exactement celui qu'on manipule le reste du temps — le film n'est pas une
 * reconstitution de l'application, c'est l'application qu'on regarde bouger
 * toute seule. Ce composant est un METTEUR EN SCÈNE : il tient une horloge,
 * déplace la caméra, et compose par-dessus les cartons, les millésimes et la
 * réglure du temps.
 *
 * D'où le partage avec `domain/film.ts` : là-bas ce que la famille raconte,
 * ici comment on le montre. Un scénario qui saurait déplacer une caméra
 * serait intestable ; une caméra qui saurait lire un graphe généalogique
 * deviendrait illisible.
 *
 * ── L'HORLOGE ────────────────────────────────────────────────────────────
 *
 * Un seul temps, en millisecondes depuis le début, tenu dans une `ref` et
 * publié dans l'état à chaque image. La caméra, elle, n'est PAS pilotée image
 * par image : elle reçoit un ordre au changement d'acte et le joue avec ses
 * propres courbes (voir `ViewportController.animateTo`). Deux boucles qui
 * écriraient dans la même transformation à soixante images par seconde se
 * disputeraient le contrôle, et l'on obtiendrait un tremblement plutôt qu'un
 * mouvement.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** La barre de progression et les commandes s'effacent si l'on ne bouge pas. */
const REPOS_MS = 2600;

/** Un carton reste lisible : il paraît, tient, s'efface — jamais en fondu plat. */
function opaciteCarton(local: number, duree: number): number {
  const entree = Math.min(1, local / 620);
  const sortie = Math.min(1, (duree - local) / 560);
  return Math.max(0, Math.min(entree, sortie));
}

/** Le centre du monde d'un groupe de personnes, et son étendue. */
function cadreDe(layout: TreeLayout, ids: string[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const position = layout.positions.get(id);
    if (!position) continue;
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x + CARD_WIDTH);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y + CARD_HEIGHT);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minY, maxY };
}

export function FilmView({ graph, layout, viewport, gapCount, onClose }: FilmViewProps) {
  const scenario = useMemo(
    () => buildScenario(graph, layout, gapCount),
    [graph, layout, gapCount],
  );

  const [t, setT] = useState(0);
  const [enCours, setEnCours] = useState(true);
  const [mainVisible, setMainVisible] = useState(true);
  const tRef = useRef(0);
  const dernierActeRef = useRef(-1);

  const { index, acte, local } = acteA(scenario, t);

  /*
   * L'HORLOGE.
   *
   * Le temps s'accumule par DIFFÉRENCE d'une image à l'autre, jamais depuis un
   * instant de départ fixe. Sans cela, mettre en pause puis reprendre ferait
   * bondir le film de toute la durée de la pause — et se déplacer dans la
   * barre de progression n'aurait aucun effet, l'origine étant figée.
   */
  useEffect(() => {
    if (!enCours) return undefined;
    let precedent = performance.now();
    let frame = 0;
    const tick = (maintenant: number): void => {
      const delta = maintenant - precedent;
      precedent = maintenant;
      tRef.current = Math.min(scenario.duree, tRef.current + delta);
      setT(tRef.current);
      if (tRef.current >= scenario.duree) {
        setEnCours(false);
        setMainVisible(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enCours, scenario.duree]);

  const allerA = useCallback((valeur: number) => {
    tRef.current = Math.max(0, valeur);
    setT(tRef.current);
    // Le prochain rendu doit rejouer le mouvement de caméra de l'acte visé,
    // même si l'on retombe sur celui qu'on regardait déjà.
    dernierActeRef.current = -1;
  }, []);

  /*
   * LA CAMÉRA, UNE FOIS PAR ACTE.
   *
   * Déclenchée au CHANGEMENT d'acte et pas à chaque image : `animateTo` porte
   * ses propres courbes d'entrée et de sortie, et le relancer soixante fois
   * par seconde le remettrait au départ soixante fois — le mouvement n'irait
   * jamais nulle part.
   */
  useEffect(() => {
    if (dernierActeRef.current === index) return;
    dernierActeRef.current = index;
    const duree = acte.duree;

    if (acte.kind === 'lieux') return; // la carte prend l'écran : rien à cadrer.

    if (acte.kind === 'titre' || acte.kind === 'final') {
      viewport.fit(layout.bounds, 120, 0.9, Math.round(duree * 0.9));
      return;
    }

    if (acte.rangee) {
      /*
       * Une rangée se regarde en LARGE : c'est une génération entière, et la
       * cadrer serré sur son milieu ne montrerait que trois cartes sur douze.
       * L'échelle vient donc de la largeur de l'arbre, bornée pour qu'une
       * rangée d'une seule personne ne remplisse pas l'écran d'un médaillon.
       */
      const largeur = Math.max(1, layout.bounds.maxX - layout.bounds.minX);
      const echelle = Math.max(0.34, Math.min(0.86, (viewport.size.width * 0.86) / largeur));
      viewport.focusPoint(
        (layout.bounds.minX + layout.bounds.maxX) / 2,
        acte.rangee.y + ROW_HEIGHT / 2,
        echelle,
        0,
        Math.round(duree * 0.92),
      );
      return;
    }

    if (acte.regarde && acte.regarde.length > 0) {
      const cadre = cadreDe(layout, acte.regarde);
      if (!cadre) return;
      viewport.fit(
        { minX: cadre.minX, maxX: cadre.maxX, minY: cadre.minY, maxY: cadre.maxY },
        150,
        acte.kind === 'racines' ? 1.05 : 0.8,
        Math.round(duree * 0.9),
      );
    }
  }, [index, acte, viewport, layout]);

  /* La main se retire quand elle ne sert pas : un film n'a pas de barre
     d'outils permanente. Elle revient au moindre mouvement. */
  useEffect(() => {
    if (!enCours) return undefined;
    const timer = window.setTimeout(() => setMainVisible(false), REPOS_MS);
    return () => window.clearTimeout(timer);
  }, [enCours, mainVisible, index]);

  useEffect(() => {
    const bouge = (): void => setMainVisible(true);
    const touche = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === ' ') {
        event.preventDefault();
        setEnCours((valeur) => !valeur);
      }
      setMainVisible(true);
    };
    window.addEventListener('pointermove', bouge, { passive: true });
    window.addEventListener('keydown', touche);
    return () => {
      window.removeEventListener('pointermove', bouge);
      window.removeEventListener('keydown', touche);
    };
  }, [onClose]);

  const fini = t >= scenario.duree;

  return (
    <div className="film" data-main={mainVisible || fini || undefined}>
      {/* Le voile : l'arbre reste visible dessous, mais recule d'un cran pour
          que les cartons se lisent sans se battre avec la ramure. */}
      <div className="film-voile" aria-hidden="true" />

      {acte.kind === 'lieux' && acte.lieux && (
        <ActeDesLieux acte={acte} local={local} />
      )}

      <div className="film-scene" data-acte={acte.kind}>
        {acte.annee !== undefined && (
          <p className="film-annee" style={{ opacity: opaciteCarton(local, acte.duree) }}>
            {acte.annee}
          </p>
        )}

        <div className="film-carton" style={{ opacity: opaciteCarton(local, acte.duree) }}>
          {acte.titre && <h2 className="film-titre">{acte.titre}</h2>}
          {acte.sous && <p className="film-sous">{acte.sous}</p>}
        </div>
      </div>

      <div className="film-main">
        <button
          type="button"
          className="film-bouton"
          onClick={() => {
            if (fini) allerA(0);
            setEnCours((valeur) => (fini ? true : !valeur));
          }}
          aria-label={fini ? 'Revoir' : enCours ? 'Mettre en pause' : 'Reprendre'}
        >
          <span aria-hidden="true">{fini ? '↺' : enCours ? '❙❙' : '▶'}</span>
        </button>

        {/* La réglure du temps : une graduation par acte, à sa vraie largeur.
            Une barre continue dirait la durée sans dire la structure ; ici on
            voit qu'il reste trois chapitres, et l'on peut y sauter. */}
        <div className="film-reglure">
          {scenario.actes.map((chapitre, i) => (
            <button
              key={`${chapitre.kind}-${i}`}
              type="button"
              className="film-chapitre"
              style={{ flexGrow: chapitre.duree }}
              data-passe={i < index || undefined}
              data-courant={i === index || undefined}
              onClick={() => allerA(debutDe(scenario, i))}
              aria-label={chapitre.titre ?? chapitre.kind}
            >
              <span
                className="film-chapitre-plein"
                style={{ width: i === index ? `${(local / chapitre.duree) * 100}%` : undefined }}
              />
            </button>
          ))}
        </div>

        <button type="button" className="film-fermer" onClick={onClose}>
          Quitter
        </button>
      </div>
    </div>
  );
}

/* ── L'acte des lieux ─────────────────────────────────────────────────────
 *
 * Le seul qui quitte l'arbre. Les lieux s'allument dans l'ordre où la famille
 * les a connus, reliés par un trait — un déplacement a un sens, et c'est ce
 * sens qu'on vient voir. Les lieux sans date attestée arrivent en dernier :
 * on ne peut pas les situer dans le mouvement sans l'inventer.
 */
function ActeDesLieux({ acte, local }: { acte: Acte; local: number }) {
  const [taille, setTaille] = useState({ w: 900, h: 560 });
  const boiteRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const boite = boiteRef.current;
    if (!boite) return undefined;
    const mesurer = (): void => {
      const rect = boite.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) setTaille({ w: rect.width, h: rect.height });
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(boite);
    return () => observateur.disconnect();
  }, []);

  const cadre: Cadre | null = useMemo(
    () => (acte.lieux ? cadrePourLieux(acte.lieux, taille.w, taille.h, 0.12) : null),
    [acte.lieux, taille],
  );

  if (!acte.lieux || acte.lieux.length === 0) return <div className="film-carte" ref={boiteRef} />;

  /*
   * L'avance du parcours.
   *
   * Il s'achève aux sept dixièmes de l'acte : un déplacement qui se termine à
   * l'instant précis où le carton s'efface ne se lit pas — il faut un temps
   * pour regarder ce qui vient d'être tracé.
   */
  const avance = Math.max(0, Math.min(1, local / (acte.duree * 0.7)));
  const trajet = acte.trajectoire ?? [];
  const atteintes = Math.max(1, Math.round(avance * trajet.length));

  return (
    <div className="film-carte" ref={boiteRef}>
      {cadre && (
        <>
          <div className="film-carte-tuiles" aria-hidden="true">
            {cadre.tuiles.map((tuile) => (
              <img
                key={`${cadre.z}:${tuile.x}:${tuile.y}`}
                className="film-carte-tuile"
                src={urlTuile(cadre.z, tuile.x, tuile.y)}
                alt=""
                style={{ left: tuile.left, top: tuile.top }}
                decoding="async"
                draggable={false}
              />
            ))}
          </div>

          <svg className="film-carte-marques" viewBox={`0 0 ${taille.w} ${taille.h}`}>
            {/* Tous les lieux, en fond : ils situent la famille, ils ne
                racontent rien à eux seuls. */}
            {acte.lieux.map((lieu) => {
              const point = cadre.projeter(lieu.lat, lieu.lon);
              return (
                <circle
                  key={lieu.key}
                  className="film-carte-lieu-fond"
                  cx={point.x}
                  cy={point.y}
                  r={2.4}
                />
              );
            })}

            {/* LE DÉPLACEMENT : le centre de gravité de chaque génération,
                relié dans l'ordre. C'est la seule ligne du film qui affirme un
                mouvement, et elle est la seule à en décrire un réellement. */}
            {trajet.length >= 2 && (
              <path
                className="film-carte-route"
                d={trajet
                  .slice(0, atteintes)
                  .map((etape, i) => {
                    const point = cadre.projeter(etape.lat, etape.lon);
                    return `${i === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
                  })
                  .join(' ')}
              />
            )}

            {trajet.slice(0, atteintes).map((etape, i) => {
              const point = cadre.projeter(etape.lat, etape.lon);
              const tete = i === atteintes - 1;
              return (
                <g key={etape.generation} className="film-carte-etape" data-tete={tete || undefined}>
                  <circle cx={point.x} cy={point.y} r={tete ? 7 : 4} />
                  {tete && (
                    <text x={point.x + 13} y={point.y + 5}>
                      {etape.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          <p className="film-carte-legende">
            Le centre de gravité de chaque génération, d’après les lieux de naissance connus.
          </p>
        </>
      )}
    </div>
  );
}
