import { useMemo, useState } from 'react';
import { FRANCE_OUTLINE } from '@/data/geo';
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
const WIDTH = 720;
const HEIGHT = 720;
const PADDING = 28;

const LAT_MIN = 41.2;
const LAT_MAX = 51.4;
const LON_MIN = -5.2;
const LON_MAX = 9.8;

function project(lat: number, lon: number): { x: number; y: number } {
  const nx = (lon - LON_MIN) / (LON_MAX - LON_MIN);
  const ny = (LAT_MAX - lat) / (LAT_MAX - LAT_MIN);
  return { x: PADDING + nx * (WIDTH - PADDING * 2), y: PADDING + ny * (HEIGHT - PADDING * 2) };
}

const OUTLINE = FRANCE_OUTLINE.map(([lat, lon], index) => {
  const { x, y } = project(lat, lon);
  return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ');

/** Contour très simplifié de la Corse — de quoi la reconnaître, rien de plus. */
const CORSICA = (
  [
    [43.01, 9.35],
    [42.7, 9.46],
    [42.35, 9.55],
    [41.86, 9.4],
    [41.39, 9.28],
    [41.36, 9.15],
    [41.63, 8.79],
    [41.92, 8.6],
    [42.35, 8.57],
    [42.62, 8.74],
    [42.96, 9.2],
  ] as Array<[number, number]>
).map(([lat, lon], index) => {
  const { x, y } = project(lat, lon);
  return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ');

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
                 aria-label={`${report.places.length} lieux situés`}>
              <path d={OUTLINE} className="map-outline" />
              <path d={CORSICA} className="map-outline" />

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
                  L’application ne contacte aucun service extérieur : elle ne peut pas deviner des
                  coordonnées. Ces lieux ne sont pas placés sur la carte plutôt que de l’être au
                  hasard.
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
