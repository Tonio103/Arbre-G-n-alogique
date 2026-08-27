import { useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { Scope } from '@/domain/scope';
import { buildTimeline, livingIn, type LifeSpan } from '@/domain/timeline';
import { formatLifespan } from '@/domain/dates';
import { ScopeBar } from './ScopeBar';

export interface TimelineViewProps {
  graph: FamilyGraph;
  focusId: string;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  people: Set<string>;
  selectedId: string | null;
  onSelectPerson: (id: string) => void;
}

const LANE_HEIGHT = 26;
const LEFT = 96;

/** Un pas de graduation lisible, quel que soit l'intervalle couvert. */
function tickStep(years: number): number {
  for (const step of [10, 20, 25, 50, 100]) {
    if (years / step <= 12) return step;
  }
  return 200;
}

/**
 * La famille dans le temps.
 *
 * Une barre par vie, rangées de sorte que deux vies qui se chevauchent ne se
 * recouvrent jamais : c'est ce qui rend visible d'un coup d'œil que trois
 * générations vivaient en même temps.
 *
 * Rien n'est inventé. Une personne sans aucune date n'a pas de barre — elle
 * est listée à part. Une vie sans date de décès s'arrête à la dernière année
 * où elle est attestée, et la barre est marquée ouverte.
 */
export function TimelineView({
  graph,
  focusId,
  scope,
  onScopeChange,
  people,
  selectedId,
  onSelectPerson,
}: TimelineViewProps) {
  const timeline = useMemo(() => buildTimeline(graph, people), [graph, people]);
  const [year, setYear] = useState<number | null>(null);

  const name = (id: string): string => graph.people.get(id)?.displayName ?? id;

  if (timeline.spans.length === 0) {
    return (
      <section className="view view--timeline" aria-label="Chronologie familiale">
        <ScopeBar graph={graph} focusId={focusId} scope={scope} onChange={onScopeChange} count={people.size} />
        <p className="view-empty lg lg--thick">
          Aucune date n’est renseignée dans cette partie de la famille.
          {timeline.undated.length > 0 && ` ${timeline.undated.length} personnes sont sans date.`}
        </p>
      </section>
    );
  }

  // Une marge d'une graduation de part et d'autre, pour que les barres
  // extrêmes ne touchent pas le bord.
  const step = tickStep(timeline.to - timeline.from || 1);
  const from = Math.floor(timeline.from / step) * step;
  const to = Math.ceil((timeline.to + 1) / step) * step;
  const span = Math.max(1, to - from);

  const width = 1000;
  const xOf = (value: number): number => LEFT + ((value - from) / span) * (width - LEFT - 24);

  const ticks: number[] = [];
  for (let value = from; value <= to; value += step) ticks.push(value);

  const height = Math.max(120, timeline.lanes * LANE_HEIGHT + 48);
  const alive = year !== null ? livingIn(timeline, year) : [];

  const barClass = (life: LifeSpan): string =>
    [
      'timeline-bar',
      life.personId === selectedId ? 'is-selected' : '',
      year !== null && alive.some((s) => s.personId === life.personId) ? 'is-alive' : '',
      year !== null && !alive.some((s) => s.personId === life.personId) ? 'is-dimmed' : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <section className="view view--timeline" aria-label="Chronologie familiale">
      <ScopeBar graph={graph} focusId={focusId} scope={scope} onChange={onScopeChange} count={people.size} />

      <div className="timeline-tools">
        <label>
          <span>Qui vivait en</span>
          <input
            type="range"
            min={from}
            max={to}
            step={1}
            value={year ?? from}
            onChange={(event) => setYear(Number(event.target.value))}
          />
          <strong>{year ?? '—'}</strong>
        </label>
        {year !== null && (
          <p>
            {alive.length} personne{alive.length > 1 ? 's' : ''} en vie
            <button type="button" className="timeline-clear" onClick={() => setYear(null)}>
              tout afficher
            </button>
          </p>
        )}
      </div>

      <div className="timeline-stage lg lg--thick">
        <svg viewBox={`0 0 ${width} ${height}`} className="timeline-svg" role="img"
             aria-label={`${timeline.spans.length} vies de ${timeline.from} à ${timeline.to}`}>
          {ticks.map((value) => (
            <g key={value} className="timeline-tick">
              <line x1={xOf(value)} y1={18} x2={xOf(value)} y2={height - 12} />
              <text x={xOf(value)} y={12}>
                {value}
              </text>
            </g>
          ))}

          {year !== null && (
            <line className="timeline-cursor" x1={xOf(year)} y1={14} x2={xOf(year)} y2={height - 12} />
          )}

          {timeline.spans.map((life) => {
            const y = 28 + life.lane * LANE_HEIGHT;
            const x1 = xOf(life.from);
            const x2 = Math.max(xOf(life.to), x1 + 3);
            return (
              <g
                key={life.personId}
                className={barClass(life)}
                onClick={() => onSelectPerson(life.personId)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectPerson(life.personId);
                }}
              >
                <title>
                  {`${name(life.personId)} — ${formatLifespan(
                    life.birthYear ? String(life.birthYear) : undefined,
                    life.deathYear ? String(life.deathYear) : undefined,
                  ) || 'dates partielles'}`}
                </title>
                <rect x={x1} y={y} width={x2 - x1} height={16} rx={8}
                      data-approximate={life.approximate || undefined}
                      data-open={life.open || undefined} />
                <text x={x1 + 8} y={y + 12} className="timeline-name">
                  {name(life.personId)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="view-note view-note--standalone">
        Une barre pointillée signale une date approximative ; un bord estompé à droite, une vie
        dont le décès n’est pas connu — elle s’arrête alors à la dernière année attestée par les
        données, jamais à une durée supposée.
      </p>

      {timeline.undated.length > 0 && (
        <div className="timeline-undated lg lg--thick">
          <h3>
            {timeline.undated.length} personne{timeline.undated.length > 1 ? 's' : ''} sans aucune
            date
          </h3>
          <p className="view-note">
            Elles n’apparaissent pas sur la frise : leur donner une position reviendrait à inventer
            une date.
          </p>
          <ul>
            {timeline.undated.map((id) => (
              <li key={id}>
                <button type="button" onClick={() => onSelectPerson(id)}>
                  {name(id)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
