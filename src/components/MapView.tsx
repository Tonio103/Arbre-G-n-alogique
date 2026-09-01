import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import {
  collectScopedPlaces,
  journeyOf,
  PLACE_KIND_LABELS,
  type PlaceKind,
  type ScopedPlace,
} from '@/domain/places';
import type { Scope } from '@/domain/scope';
import { useGlassScrollSuspend } from '@/hooks/useGlassScrollSuspend';
import { ScopeBar } from './ScopeBar';
import { IconButton } from './TopBar';
import { FitIcon, MinusIcon, PlusIcon } from './icons';

export interface MapViewProps {
  graph: FamilyGraph;
  focusId: string;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  people: Set<string>;
  onSelectPerson: (id: string) => void;
}

/*
 * Le cadre initial est plus large que celui de la vignette de coin : il doit
 * tenir la Corse, dont les longitudes dépassent 9°. Sans ça, un marqueur à
 * Bastia sortirait du cadre — ou pire, serait replié sur son bord.
 */
const LAT_MIN = 41.2;
const LAT_MAX = 51.4;
const LON_MIN = -5.2;
const LON_MAX = 9.8;
const PADDING = 24;

/*
 * ── Le fond de carte ─────────────────────────────────────────────────────
 *
 * De vraies tuiles OpenStreetMap plutôt qu'un contour dessiné à la main : les
 * côtes, les reliefs, les villes s'y reconnaissent vraiment, là où l'ancien
 * tracé (onze points pour la Corse) ne faisait que suggérer une forme.
 *
 * Ce que ça change dans le fonctionnement de l'application, pour que ce soit
 * su et non découvert : c'est le premier appel à un domaine TIERS — le
 * serveur de données de l'application elle-même mis à part, tout le reste,
 * décor compris, était jusqu'ici un dégradé CSS qui ne quittait jamais le
 * navigateur. Chaque ouverture de cette vue demande les tuiles à
 * `tile.openstreetmap.org`. La licence d'OpenStreetMap impose en retour la
 * mention « © OpenStreetMap contributors », visible et non retirée : elle est
 * posée en coin de carte, jamais masquée.
 *
 * ── Le zoom ──────────────────────────────────────────────────────────────
 *
 * Zoomer ne grossit pas les mêmes tuiles au risque de les rendre floues :
 * chaque cran change de NIVEAU de tuile — la géographie du web (celle de
 * toutes les cartes en ligne) double la résolution à chaque niveau. La
 * fenêtre affichée garde toujours la même taille en pixels ; ce qui change,
 * c'est la portion du monde qu'elle couvre, et les tuiles demandées au
 * niveau qui correspond. Le résultat reste net à n'importe quel cran, comme
 * sur une vraie carte.
 */
const TILE = 256;
const MIN_ZOOM = 5;
const MAX_ZOOM = 15;
const START_ZOOM = 6;

const tileX = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};
/** L'inverse de `tileY` : la latitude d'un Y de tuile donné, à un niveau donné. */
const tileYToLat = (ty: number, z: number): number => {
  const n = Math.PI - (2 * Math.PI * ty) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};
const tileXToLon = (tx: number, z: number): number => (tx / 2 ** z) * 360 - 180;

// Le cadre de départ — toute la France et la Corse — donne la taille FIXE de
// la fenêtre, en pixels : ce qui change avec le zoom, c'est le niveau de
// tuile demandé pour la remplir, jamais cette taille-là.
const startXMinF = tileX(LON_MIN, START_ZOOM);
const startXMaxF = tileX(LON_MAX, START_ZOOM);
const startYMinF = tileY(LAT_MAX, START_ZOOM);
const startYMaxF = tileY(LAT_MIN, START_ZOOM);
const VIEW_W = (startXMaxF - startXMinF) * TILE + PADDING * 2;
const VIEW_H = (startYMaxF - startYMinF) * TILE + PADDING * 2;
const START_LAT = (LAT_MIN + LAT_MAX) / 2;
const START_LON = (LON_MIN + LON_MAX) / 2;

interface MapCamera {
  z: number;
  lat: number;
  lon: number;
}

/** Le coin haut-gauche de la fenêtre, en pixels du MONDE au niveau `z`. */
function windowOrigin(camera: MapCamera): { x: number; y: number } {
  return {
    x: tileX(camera.lon, camera.z) * TILE - VIEW_W / 2,
    y: tileY(camera.lat, camera.z) * TILE - VIEW_H / 2,
  };
}

function projectAt(camera: MapCamera, origin: { x: number; y: number }, lat: number, lon: number) {
  return {
    x: tileX(lon, camera.z) * TILE - origin.x,
    y: tileY(lat, camera.z) * TILE - origin.y,
  };
}

/** Chaque tuile entière que couvre la fenêtre, à ce niveau de zoom. */
function tilesFor(camera: MapCamera, origin: { x: number; y: number }) {
  const count = 2 ** camera.z;
  const txStart = Math.max(0, Math.floor(origin.x / TILE));
  const txEnd = Math.min(count - 1, Math.floor((origin.x + VIEW_W) / TILE));
  const tyStart = Math.max(0, Math.floor(origin.y / TILE));
  const tyEnd = Math.min(count - 1, Math.floor((origin.y + VIEW_H) / TILE));

  const tiles: Array<{ x: number; y: number; left: number; top: number }> = [];
  for (let tx = txStart; tx <= txEnd; tx += 1) {
    for (let ty = tyStart; ty <= tyEnd; ty += 1) {
      tiles.push({ x: tx, y: ty, left: tx * TILE - origin.x, top: ty * TILE - origin.y });
    }
  }
  return tiles;
}

const KIND_ORDER: PlaceKind[] = ['birth', 'residence', 'union', 'death'];

/**
 * La carte des lieux de la famille.
 *
 * Elle ne montre que ce qui est écrit dans les fiches, et seulement les lieux
 * dont on connaît les coordonnées. Les autres — « Disparu en mer d'Islande »,
 * une commune pas encore répertoriée — sont listés sous la carte plutôt que
 * placés au jugé : sur une carte, une position est une affirmation.
 */
export function MapView({
  graph,
  focusId,
  scope,
  onScopeChange,
  people,
  onSelectPerson,
}: MapViewProps) {
  const report = useMemo(() => collectScopedPlaces(graph, people), [graph, people]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [journeyId, setJourneyId] = useState<string | null>(null);

  const active = report.places.find((place) => place.key === activeKey) ?? null;
  const journey = useMemo(
    () => (journeyId ? journeyOf(graph, journeyId) : []),
    [graph, journeyId],
  );

  const maxPeople = Math.max(1, ...report.places.map((place) => place.people.length));
  const radiusOf = (place: ScopedPlace): number =>
    6 + Math.round((place.people.length / maxPeople) * 10);

  const name = (id: string): string => graph.people.get(id)?.displayName ?? id;

  /*
   * ── Le zoom ────────────────────────────────────────────────────────────
   *
   * La caméra tient en trois nombres : le niveau de tuile et le point
   * géographique regardé au centre. Tout le reste — quelles tuiles charger,
   * où poser chaque marqueur — s'en déduit à chaque rendu, jamais l'inverse :
   * on ne garde pas de position en pixels qui se déréglerait d'un niveau à
   * l'autre.
   */
  const [camera, setCamera] = useState<MapCamera>({ z: START_ZOOM, lat: START_LAT, lon: START_LON });
  const origin = useMemo(() => windowOrigin(camera), [camera]);
  const tiles = useMemo(() => tilesFor(camera, origin), [camera, origin]);
  const project = useCallback((lat: number, lon: number) => projectAt(camera, origin, lat, lon), [camera, origin]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startOrigin: { x: number; y: number } } | null>(null);
  const viewRef = useGlassScrollSuspend<HTMLElement>();

  /*
   * Suspendre la teinte du fond de carte pendant qu'on la déplace.
   *
   * `.map-tiles` porte un filtre CSS — c'est lui qui recolore les tuiles
   * OpenStreetMap pour les accorder au thème (voir `views.css`). Un filtre
   * posé sur un groupe qui contient plusieurs images force le navigateur à
   * traiter tout le groupe comme une seule surface à re-rasteriser dès qu'UNE
   * tuile bouge — et ici, toutes bougent à chaque image d'un glissé, puisque
   * c'est `camera` qui pilote leur position. La même dépense, au fond, que le
   * flou des plaques de nom pendant un glissé de l'arbre : un effet dont le
   * rendu dépend de ce qu'il y a dessous ne peut pas être mis en cache dans un
   * calque tant que ce dessous continue de changer.
   *
   * `data-panning`, posé sur `.map-stage` à chaque changement de caméra et
   * retiré dans le même délai que partout ailleurs, suspend ce filtre-là
   * précisément pendant le geste — pas d'effet sur le premier rendu, gardé
   * par `mountedRef`.
   */
  const mapStageRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    const stage = mapStageRef.current;
    if (!stage || !mountedRef.current) {
      mountedRef.current = true;
      return undefined;
    }
    stage.setAttribute('data-panning', '');
    const timer = window.setTimeout(() => stage.removeAttribute('data-panning'), 200);
    return () => window.clearTimeout(timer);
  }, [camera]);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOrigin: origin,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dx = ((event.clientX - drag.startClientX) / rect.width) * VIEW_W;
    const dy = ((event.clientY - drag.startClientY) / rect.height) * VIEW_H;
    const newOriginX = drag.startOrigin.x - dx;
    const newOriginY = drag.startOrigin.y - dy;
    setCamera((current) => ({
      ...current,
      lon: tileXToLon((newOriginX + VIEW_W / 2) / TILE, current.z),
      lat: tileYToLat((newOriginY + VIEW_H / 2) / TILE, current.z),
    }));
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  /**
   * Change le zoom d'un cran, en gardant fixe à l'écran le point géographique
   * visé — sous le curseur pour la molette, au centre pour les boutons.
   *
   * Tout se recalcule à partir de `current`, l'état AU MOMENT DE L'APPEL —
   * jamais depuis `camera`/`origin` fermés dans la portée du rendu qui a créé
   * cette fonction. Sans ça, `zoomTo` changerait d'identité à chaque zoom (son
   * calcul dépendrait de `origin`, qui dépend de `camera`) : le seul endroit
   * qui l'appelle en dehors d'un clic — l'écouteur de molette, posé une seule
   * fois ci-dessous — se retrouverait à lire un niveau de zoom figé au tout
   * premier rendu.
   */
  const zoomTo = useCallback((deltaZ: number, atClientX?: number, atClientY?: number) => {
    setCamera((current) => {
      const clampedZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.z + deltaZ));
      if (clampedZ === current.z) return current;

      const currentOrigin = windowOrigin(current);
      const rect = svgRef.current?.getBoundingClientRect();
      const anchorWorld =
        atClientX !== undefined && atClientY !== undefined && rect && rect.width > 0 && rect.height > 0
          ? {
              x: currentOrigin.x + ((atClientX - rect.left) / rect.width) * VIEW_W,
              y: currentOrigin.y + ((atClientY - rect.top) / rect.height) * VIEW_H,
            }
          : { x: currentOrigin.x + VIEW_W / 2, y: currentOrigin.y + VIEW_H / 2 };

      const anchorLon = tileXToLon(anchorWorld.x / TILE, current.z);
      const anchorLat = tileYToLat(anchorWorld.y / TILE, current.z);

      // Où ce point tombe-t-il, en fraction de la fenêtre actuelle ? On l'y
      // replace après le changement de niveau, en recalant le centre.
      const screenFracX = (anchorWorld.x - currentOrigin.x) / VIEW_W;
      const screenFracY = (anchorWorld.y - currentOrigin.y) / VIEW_H;

      const anchorWorldNew = { x: tileX(anchorLon, clampedZ) * TILE, y: tileY(anchorLat, clampedZ) * TILE };
      const newOriginX = anchorWorldNew.x - screenFracX * VIEW_W;
      const newOriginY = anchorWorldNew.y - screenFracY * VIEW_H;

      return {
        z: clampedZ,
        lon: tileXToLon((newOriginX + VIEW_W / 2) / TILE, clampedZ),
        lat: tileYToLat((newOriginY + VIEW_H / 2) / TILE, clampedZ),
      };
    });
  }, []);

  const resetCamera = useCallback(() => {
    setCamera({ z: START_ZOOM, lat: START_LAT, lon: START_LON });
  }, []);

  /*
   * La molette doit empêcher le défilement de la PAGE en dessous — mais React
   * pose son propre écouteur de rendu en mode passif pour `wheel`, ce qui rend
   * `preventDefault()` silencieusement inopérant depuis un `onWheel` JSX. On
   * pose donc l'écouteur nous-mêmes, explicitement actif.
   *
   * `onWheelNative` doit garder la MÊME identité entre la pose et le retrait
   * — `removeEventListener` n'agit que sur la fonction exacte qu'on lui
   * passe. Comme elle ne dépend que de `zoomTo`, lui-même stable, elle l'est
   * aussi : le callback de ref ci-dessous ne s'exécute donc qu'au montage et
   * au démontage réels du SVG, jamais à chaque rendu.
   */
  const onWheelNative = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      zoomTo(event.deltaY < 0 ? 1 : -1, event.clientX, event.clientY);
    },
    [zoomTo],
  );

  const setSvgRef = useCallback(
    (node: SVGSVGElement | null) => {
      if (svgRef.current) svgRef.current.removeEventListener('wheel', onWheelNative);
      svgRef.current = node;
      if (node) node.addEventListener('wheel', onWheelNative, { passive: false });
    },
    [onWheelNative],
  );

  return (
    <section className="view view--map" aria-label="Carte familiale" ref={viewRef}>
      <ScopeBar
        graph={graph}
        focusId={focusId}
        scope={scope}
        onChange={onScopeChange}
        count={people.size}
      />

      {report.places.length === 0 && report.unlocated.length === 0 ? (
        <p className="view-empty lg lg--thick">
          Aucun lieu n’est renseigné dans cette partie de la famille. Les lieux se saisissent dans
          la fiche de chaque personne : naissance, décès, résidences.
        </p>
      ) : (
        <div className="map-layout">
          <div className="map-stage lg lg--thick" ref={mapStageRef}>
            <svg
              ref={setSvgRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="map-svg"
              role="img"
              aria-label={`${report.places.length} lieux situés, sur fond OpenStreetMap — niveau de zoom ${camera.z}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {/* Un fond uni sous les tuiles : si l'une d'elles ne charge pas
                  (hors ligne, service coupé), on garde un cadre propre plutôt
                  qu'un trou transparent. */}
              <rect x={0} y={0} width={VIEW_W} height={VIEW_H} className="map-tile-backing" />
              <g className="map-tiles">
                {tiles.map((tile) => (
                  <image
                    key={`${camera.z}-${tile.x}-${tile.y}`}
                    href={`https://tile.openstreetmap.org/${camera.z}/${tile.x}/${tile.y}.png`}
                    x={tile.left}
                    y={tile.top}
                    width={TILE}
                    height={TILE}
                    preserveAspectRatio="none"
                  />
                ))}
              </g>

              {/* Le parcours d'une personne, tracé par-dessus le fond. */}
              {journeyId && (
                <polyline
                  className="map-journey"
                  points={journey
                    .filter((step) => step.located && step.year !== undefined)
                    .map((step) => {
                      const place = report.places.find((p) => p.label === step.label);
                      if (!place) return '';
                      const { x, y } = project(place.lat, place.lon);
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    })
                    .filter(Boolean)
                    .join(' ')}
                />
              )}

              {report.places.map((place) => {
                const { x, y } = project(place.lat, place.lon);
                return (
                  <g key={place.key} className="map-marker" data-active={place.key === activeKey || undefined}>
                    <circle
                      cx={x}
                      cy={y}
                      r={radiusOf(place)}
                      className="map-marker-dot"
                      onClick={() => setActiveKey(place.key === activeKey ? null : place.key)}
                    />
                    <text x={x} y={y - radiusOf(place) - 6} className="map-marker-label">
                      {place.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div className="map-zoom control-group lg lg--control lg--bar">
              <IconButton label="Dézoomer" onClick={() => zoomTo(-1)}>
                <MinusIcon />
              </IconButton>
              <IconButton label="Zoomer" onClick={() => zoomTo(1)}>
                <PlusIcon />
              </IconButton>
              <IconButton label="Revenir à toute la famille" onClick={resetCamera}>
                <FitIcon />
              </IconButton>
            </div>

            {/*
              Attribution OpenStreetMap : la licence des données (ODbL) impose
              cette mention, visible, sur toute carte qui les affiche — elle
              ne se retire pas et ne se cache pas dans un coin illisible.
            */}
            <a
              className="map-attribution"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              © OpenStreetMap contributors
            </a>
          </div>

          <aside className="map-side">
            {active ? (
              <div className="map-card lg lg--thick">
                <header>
                  <h3>{active.label}</h3>
                  <p>
                    {active.people.length} personne{active.people.length > 1 ? 's' : ''} liée
                    {active.people.length > 1 ? 's' : ''} à ce lieu
                  </p>
                </header>
                {KIND_ORDER.map((kind) => {
                  const ids = [
                    ...new Set(
                      active.events.filter((e) => e.kind === kind).map((e) => e.personId),
                    ),
                  ];
                  if (ids.length === 0) return null;
                  return (
                    <div key={kind} className="map-group">
                      <h4>{PLACE_KIND_LABELS[kind]}</h4>
                      <ul>
                        {ids.map((id) => (
                          <li key={id}>
                            <button type="button" onClick={() => onSelectPerson(id)}>
                              {name(id)}
                            </button>
                            <button
                              type="button"
                              className="map-journey-toggle"
                              data-active={journeyId === id || undefined}
                              onClick={() => setJourneyId(journeyId === id ? null : id)}
                            >
                              parcours
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="map-hint lg lg--chip">
                Cliquez un marqueur pour voir qui s’y rattache.
              </p>
            )}

            {journeyId && journey.length > 0 && (
              <div className="map-card lg lg--thick">
                <header>
                  <h3>Parcours de {name(journeyId)}</h3>
                </header>
                <ol className="journey">
                  {journey.map((step, index) => (
                    <li key={`${step.raw}-${index}`} data-undated={step.year === undefined || undefined}>
                      <span className="journey-year">{step.year ?? 'date inconnue'}</span>
                      <span className="journey-place">{step.label}</span>
                      <span className="journey-kind">{PLACE_KIND_LABELS[step.kind]}</span>
                    </li>
                  ))}
                </ol>
                <p className="view-note">
                  Seuls les lieux écrits dans sa fiche apparaissent, dans l’ordre de leurs dates.
                  Les étapes non datées sont mises à la fin plutôt que placées au jugé.
                </p>
              </div>
            )}

            {report.unlocated.length > 0 && (
              <div className="map-card lg lg--thick">
                <header>
                  <h3>Lieux non situés</h3>
                  <p>Nommés dans les fiches, mais absents du répertoire de coordonnées.</p>
                </header>
                <ul className="map-unlocated">
                  {report.unlocated.map((group) => (
                    <li key={group.key}>
                      <strong>{group.label}</strong>
                      <span>
                        {group.people.map((id, index) => (
                          <button key={id} type="button" onClick={() => onSelectPerson(id)}>
                            {name(id)}
                            {index < group.people.length - 1 ? ', ' : ''}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="view-note">
                  Aucun de ces noms n’a de coordonnées connues dans le répertoire de l’application :
                  ils ne sont pas placés sur la carte plutôt que de l’être au hasard.
                </p>
              </div>
            )}

            {report.withoutPlace > 0 && (
              <p className="view-note view-note--standalone">
                {report.withoutPlace} personne{report.withoutPlace > 1 ? 's' : ''} de ce périmètre
                ne mentionne{report.withoutPlace > 1 ? 'nt' : ''} aucun lieu.
              </p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
