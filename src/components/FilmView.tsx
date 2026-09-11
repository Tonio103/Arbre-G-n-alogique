import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { TreeLayout } from '@/domain/layout';
import { acteA, buildScenario, debutDe, montreA, type Acte } from '@/domain/film';
import type { HighlightSet } from '@/domain/relations';
import type { ViewportController } from '@/view/viewport';
import { CARD_HEIGHT, CARD_WIDTH } from '@/view/metrics';
import { cadrePourLieux, urlTuile, type Cadre } from '@/view/tuiles';

export interface FilmViewProps {
  graph: FamilyGraph;
  layout: TreeLayout;
  viewport: ViewportController;
  gapCount: number;
  /**
   * La mise en scène du plan courant, remontée à l'arbre.
   *
   * `null` : l'arbre reprend son état ordinaire. Sinon c'est un ensemble
   * d'accentuation comme celui d'une sélection — l'arbre sait déjà le rendre,
   * il n'a rien de neuf à apprendre du film.
   */
  onScene: (scene: HighlightSet | null) => void;
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
 * exactement celui qu'on manipule le reste du temps. Ce composant est un
 * METTEUR EN SCÈNE : il tient une horloge, déplace la caméra, DÉSIGNE ce qui
 * est encré, et compose par-dessus les cartons et les millésimes.
 *
 * ── LA MISE EN SCÈNE, ET POURQUOI ELLE PASSE PAR L'ACCENTUATION ─────────
 *
 * La première version cadrait et rien d'autre : le carton annonçait « Les
 * racines » pendant que l'arbre entier restait à l'écran. Un plan qui
 * contredit sa légende ne se rattrape par aucun mouvement de caméra.
 *
 * Chaque acte désigne maintenant qui il montre, et le film fabrique de cela un
 * `HighlightSet` — la même structure que produit un clic sur quelqu'un. Le
 * reste de l'arbre s'estompe au lieu de disparaître : la silhouette entière
 * demeure, en fantôme, et l'histoire s'y encre. C'est ce qui donne au plan de
 * croissance son sujet — quelque chose qui S'ÉTEND dans une forme qu'on
 * pressent déjà.
 *
 * Rien n'a été ajouté à l'arbre pour ça. Il savait déjà rendre une
 * accentuation ; le film ne fait que lui en donner une qui ne vient pas d'un
 * clic.
 *
 * ── L'HORLOGE ET LA CAMÉRA ───────────────────────────────────────────────
 *
 * Un seul temps, en millisecondes depuis le début, tenu dans une `ref`. La
 * caméra n'est PAS pilotée image par image : elle reçoit un ordre au
 * changement d'acte et le joue avec ses propres courbes. Deux boucles qui
 * écriraient dans la même transformation soixante fois par seconde se
 * disputeraient le contrôle, et l'on obtiendrait un tremblement.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** La barre de progression et les commandes s'effacent si l'on ne bouge pas. */
const REPOS_MS = 2600;

/** Un carton paraît, tient, s'efface — jamais en fondu plat. */
function opaciteCarton(local: number, duree: number): number {
  const entree = Math.min(1, local / 620);
  const sortie = Math.min(1, (duree - local) / 560);
  return Math.max(0, Math.min(entree, sortie));
}

/** Le cadre du monde qu'occupe un groupe de personnes. */
function cadreDe(layout: TreeLayout, ids: Iterable<string>) {
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

export function FilmView({
  graph,
  layout,
  viewport,
  gapCount,
  onScene,
  onClose,
}: FilmViewProps) {
  const scenario = useMemo(
    () => buildScenario(graph, layout, gapCount),
    [graph, layout, gapCount],
  );

  const [t, setT] = useState(0);
  const [enCours, setEnCours] = useState(true);
  const [mainVisible, setMainVisible] = useState(true);
  const tRef = useRef(0);
  const dernierActeRef = useRef(-1);
  const derniereTailleRef = useRef(-1);

  const { index, acte, local } = acteA(scenario, t);

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
    dernierActeRef.current = -1;
    derniereTailleRef.current = -1;
  }, []);

  /*
   * ── LA MISE EN SCÈNE ──────────────────────────────────────────────────
   *
   * Publiée seulement quand elle CHANGE, jamais à chaque image. Pendant le
   * plan de croissance, l'ensemble ne grandit qu'aux entrées de génération :
   * dix fois sur douze secondes, contre sept cent vingt si l'on avait publié
   * par image. Chaque publication redessine l'arbre entier — c'est le genre
   * de détail qui décide si un film est fluide ou s'il hache.
   */
  useEffect(() => {
    const montre = montreA(acte, local, layout);
    if (!montre) {
      if (derniereTailleRef.current !== 0) {
        derniereTailleRef.current = 0;
        onScene(null);
      }
      return;
    }
    if (montre.size === derniereTailleRef.current) return;
    derniereTailleRef.current = montre.size;

    /*
     * Une union n'est encrée que si TOUT ce qu'elle relie est montré. La
     * règle est celle de la sélection (voir `TreeCanvas`), et pour la même
     * raison : un trait noir qui aboutit à un fantôme se lit comme une erreur
     * de tracé, pas comme une intention.
     */
    const unions = new Set<string>();
    for (const union of layout.unions) {
      if (union.partners.length === 0) continue;
      let complet = true;
      for (const partner of union.partners) if (!montre.has(partner.id)) complet = false;
      for (const child of union.children) if (!montre.has(child.id)) complet = false;
      if (complet) unions.add(union.id);
    }

    const people = new Map<string, 'related'>();
    for (const id of montre) people.set(id, 'related');
    onScene({ people: people as HighlightSet['people'], unions, touched: new Set() });
  }, [acte, local, layout, onScene]);

  // L'arbre reprend son état ordinaire quand le film se retire.
  useEffect(() => () => onScene(null), [onScene]);

  /*
   * ── LA CAMÉRA ─────────────────────────────────────────────────────────
   *
   * Un ordre par acte, avec une durée PLUS LONGUE que l'acte lui-même : le
   * mouvement n'a donc jamais le temps de s'achever, et la caméra ne se fige
   * pas avant la coupe. C'est le geste d'un appareil sur rail — et le
   * contraire de la première version, où chaque plan arrivait à destination
   * puis attendait, immobile, la fin de son carton.
   */
  useEffect(() => {
    if (dernierActeRef.current === index) return;
    dernierActeRef.current = index;
    const course = Math.round(acte.duree * 1.5);

    if (acte.kind === 'lieux') return; // la carte prend l'écran : rien à cadrer.

    if (acte.kind === 'titre') {
      viewport.fit(layout.bounds, 150, 0.86, course);
      return;
    }
    if (acte.kind === 'final') {
      viewport.fit(layout.bounds, 90, 0.86, course);
      return;
    }

    if (acte.kind === 'pousse') {
      // On part serré sur les racines et l'on s'ouvre à l'arbre entier : le
      // mouvement dure tout le plan, il EST le plan.
      viewport.fit(layout.bounds, 140, 0.86, course);
      return;
    }

    const cible = acte.regarde && acte.regarde.length > 0 ? acte.regarde : undefined;
    const cadre = cible ? cadreDe(layout, cible) : null;
    if (!cadre) return;
    viewport.fit(
      cadre,
      acte.kind === 'portrait' ? 210 : 150,
      acte.kind === 'portrait' ? 1.25 : acte.kind === 'racines' ? 1.05 : 0.8,
      course,
    );
  }, [index, acte, viewport, layout]);

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

  /*
   * LE MILLÉSIME QUI COURT.
   *
   * Pendant la croissance, il ne se pose pas : il avance avec l'arbre, de la
   * première naissance connue à la dernière. C'est la seule chose du film qui
   * dise la DURÉE de ce qu'on regarde — un arbre qui pousse en douze secondes
   * couvre deux siècles et demi, et rien d'autre ne le rappelle.
   */
  let annee = acte.annee;
  if (acte.kind === 'pousse' && acte.de !== undefined && acte.a !== undefined) {
    const avance = Math.max(0, Math.min(1, local / (acte.duree * 0.8)));
    annee = Math.round(acte.de + (acte.a - acte.de) * avance);
  }

  const sujet = acte.sujet ? graph.people.get(acte.sujet) : undefined;

  return (
    <div className="film" data-main={mainVisible || fini || undefined}>
      <div className="film-voile" aria-hidden="true" />

      {acte.kind === 'lieux' && acte.lieux && <ActeDesLieux acte={acte} local={local} />}

      <div className="film-scene" data-acte={acte.kind}>
        {annee !== undefined && (
          <p
            className="film-annee"
            data-court={acte.kind === 'pousse' || undefined}
            style={{ opacity: opaciteCarton(local, acte.duree) }}
          >
            {annee}
          </p>
        )}

        <div className="film-carton" style={{ opacity: opaciteCarton(local, acte.duree) }}>
          {/* Un portrait porte son initiale : le carton nomme quelqu'un, et
              l'on doit pouvoir le relier au médaillon vers lequel la caméra
              vient de descendre. */}
          {sujet && <span className="film-camee">{sujet.initials}</span>}
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
 * Le seul qui quitte l'arbre. On y trace le CENTRE DE GRAVITÉ de chaque
 * génération, relié dans l'ordre — pas les lieux eux-mêmes dans l'ordre des
 * dates, ce qui donnait une toile d'araignée en travers de la France.
 */
function ActeDesLieux({ acte, local }: { acte: Acte; local: number }) {
  const [taille, setTaille] = useState({ w: 760, h: 520 });
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
