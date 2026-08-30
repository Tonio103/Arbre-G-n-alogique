import { useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import {
  collectScopedPlaces,
  journeyOf,
  PLACE_KIND_LABELS,
  type PlaceKind,
  type ScopedPlace,
} from '@/domain/places';
import type { Scope } from '@/domain/scope';
import { ScopeBar } from './ScopeBar';

export interface MapViewProps {
  graph: FamilyGraph;
  focusId: string;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  people: Set<string>;
  onSelectPerson: (id: string) => void;
}

/*
 * Le cadre est plus large que celui de la vignette de coin : il doit tenir la
 * Corse, dont les longitudes dépassent 9°. Sans ça, un marqueur à Bastia
 * sortirait du cadre — ou pire, serait replié sur son bord.
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
 * navigateur. Chaque ouverture de cette vue demande désormais les tuiles à
 * `tile.openstreetmap.org`. La licence d'OpenStreetMap impose en retour la
 * mention « © OpenStreetMap contributors », visible et non retirée : elle est
 * posée en coin de carte, jamais masquée.
 *
 * La projection change avec : un simple dégradé linéaire suffisait à un
 * contour schématique, mais des tuiles réelles suivent la projection de
 * Mercator — la même qu'utilise la carte, sans quoi un marqueur dériverait de
 * sa vraie position à mesure qu'on s'éloigne de l'équateur.
 */
const ZOOM = 6;
const TILE = 256;

const tileX = (lon: number): number => ((lon + 180) / 360) * 2 ** ZOOM;
const tileY = (lat: number): number => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** ZOOM;
};

const xMinF = tileX(LON_MIN);
const xMaxF = tileX(LON_MAX);
const yMinF = tileY(LAT_MAX); // le nord donne le Y le plus PETIT en Mercator
const yMaxF = tileY(LAT_MIN);

const MOSAIC_W = (xMaxF - xMinF) * TILE;
const MOSAIC_H = (yMaxF - yMinF) * TILE;
const WIDTH = MOSAIC_W + PADDING * 2;
const HEIGHT = MOSAIC_H + PADDING * 2;

function project(lat: number, lon: number): { x: number; y: number } {
  return {
    x: PADDING + (tileX(lon) - xMinF) * TILE,
    y: PADDING + (tileY(lat) - yMinF) * TILE,
  };
}

/** Chaque tuile entière que couvre la zone, en coordonnées de dalles OSM. */
const TILES: Array<{ x: number; y: number; left: number; top: number }> = [];
for (let tx = Math.floor(xMinF); tx <= Math.floor(xMaxF); tx += 1) {
  for (let ty = Math.floor(yMinF); ty <= Math.floor(yMaxF); ty += 1) {
    TILES.push({
      x: tx,
      y: ty,
      left: PADDING + (tx - xMinF) * TILE,
      top: PADDING + (ty - yMinF) * TILE,
    });
  }
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

  return (
    <section className="view view--map" aria-label="Carte familiale">
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
          <div className="map-stage lg lg--thick">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="map-svg" role="img"
                 aria-label={`${report.places.length} lieux situés, sur fond OpenStreetMap`}>
              {/* Un fond uni sous les tuiles : si l'une d'elles ne charge pas
                  (hors ligne, service coupé), on garde un cadre propre plutôt
                  qu'un trou transparent. */}
              <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="map-tile-backing" />
              <g className="map-tiles">
                {TILES.map((tile) => (
                  <image
                    key={`${tile.x}-${tile.y}`}
                    href={`https://tile.openstreetmap.org/${ZOOM}/${tile.x}/${tile.y}.png`}
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
