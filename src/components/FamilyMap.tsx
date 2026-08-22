import { useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import { collectFamilyPlaces, type FamilyPlace } from '@/domain/places';
import { FRANCE_OUTLINE } from '@/data/geo';
import { MapIcon, CloseIcon } from './icons';

export interface FamilyMapProps {
  graph: FamilyGraph;
  onSelectPlace: (personId: string) => void;
}

const WIDTH = 250;
const HEIGHT = 200;
const PADDING = 10;

const LAT_MIN = 42.4;
const LAT_MAX = 51.3;
const LON_MIN = -4.9;
const LON_MAX = 8.1;

function project(lat: number, lon: number): { x: number; y: number } {
  const nx = (lon - LON_MIN) / (LON_MAX - LON_MIN);
  const ny = (LAT_MAX - lat) / (LAT_MAX - LAT_MIN);
  return { x: PADDING + nx * (WIDTH - PADDING * 2), y: PADDING + ny * (HEIGHT - PADDING * 2) };
}

const OUTLINE_PATH = FRANCE_OUTLINE.map(([lat, lon], index) => {
  const { x, y } = project(lat, lon);
  return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ');

/**
 * Les lieux où la famille a vécu, en un coup d'œil.
 *
 * Repliée par défaut sous forme de simple chiffre — « 23 villes » — pour ne
 * jamais disputer l'attention au diagramme. Un clic déplie une carte
 * stylisée (pas un relevé cadastral : juste de quoi situer les points les
 * uns par rapport aux autres) où chaque lieu mène à la première personne qui
 * y est née.
 */
export function FamilyMap({ graph, onSelectPlace }: FamilyMapProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<FamilyPlace | null>(null);

  const places = useMemo(() => collectFamilyPlaces(graph), [graph]);

  const pathPoints = useMemo(
    () =>
      places
        .map((place) => {
          const { x, y } = project(place.lat, place.lon);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' '),
    [places],
  );

  if (places.length === 0) return null;

  const pick = (place: FamilyPlace): void => {
    setActive(place);
    onSelectPlace(place.representativeId);
  };

  return (
    <div className="family-map-widget">
      {open && (
        <div className="family-map-panel lg lg--thick" role="dialog" aria-label="Lieux de vie de la famille">
          <div className="family-map-panel-head">
            <span>
              Votre famille a vécu dans {places.length} ville{places.length > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label="Fermer la carte"
            >
              <CloseIcon />
            </button>
          </div>
          <svg
            className="family-map-svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label="Carte des lieux de vie de la famille"
          >
            <path d={`${OUTLINE_PATH} Z`} className="family-map-outline" />
            <polyline points={pathPoints} className="family-map-path" />
            {places.map((place) => {
              const { x, y } = project(place.lat, place.lon);
              return (
                <g
                  key={place.name}
                  transform={`translate(${x},${y})`}
                  className="family-map-dot"
                  data-active={active?.name === place.name || undefined}
                  onClick={() => pick(place)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      pick(place);
                    }
                  }}
                >
                  <circle r="6.5" className="family-map-glow" />
                  <circle r="2.4" className="family-map-core" />
                  <title>
                    {place.name} · {place.personIds.length} personne{place.personIds.length > 1 ? 's' : ''}
                  </title>
                </g>
              );
            })}
          </svg>
          <p className="family-map-caption">
            {active
              ? `${active.name} — ${active.personIds.length} personne${active.personIds.length > 1 ? 's' : ''}${active.earliestYear ? `, depuis ${active.earliestYear}` : ''}`
              : 'Touchez un point pour rejoindre la famille qui y a vécu.'}
          </p>
        </div>
      )}
      <button
        type="button"
        className="family-map-stat"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <MapIcon />
        <span>
          {places.length} ville{places.length > 1 ? 's' : ''}
        </span>
      </button>
    </div>
  );
}
