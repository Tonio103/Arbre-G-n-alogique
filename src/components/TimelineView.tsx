import { useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import { useGlassScrollSuspend } from '@/hooks/useGlassScrollSuspend';
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

/*
 * Une ligne par personne, son nom dans une colonne à gauche.
 *
 * Les barres étaient d'abord empilées par « voies » pour tenir en hauteur, le
 * nom écrit à l'intérieur. Mais une vie courte donne une barre de trente
 * pixels, et un nom en fait quatre-vingt-dix : les noms débordaient sur les
 * barres voisines et la frise devenait illisible. Une ligne par personne coûte
 * de la hauteur — qu'on peut faire défiler — et ne coûte rien à la lecture.
 * Les chevauchements se voient toujours : les barres partagent le même axe.
 */
const ROW_H = 24;
const LEFT = 168;
const TOP = 30;

/** Un pas de graduation lisible, quel que soit l'intervalle couvert. */
function tickStep(years: number): number {
  for (const step of [10, 20, 25, 50, 100]) {
    if (years / step <= 12) return step;
  }
  return 200;
}

/**
 * Le pas des graduations PORTÉES, celles qui reçoivent une date.
 *
 * Une règle graduée ne chiffre pas chacun de ses traits — un double décimètre
 * porte ses centimètres et tait ses millimètres. La frise faisait l'inverse :
 * chaque graduation, quel qu'en fût le pas, portait son millésime et tirait un
 * trait sur toute la hauteur. À treize traits pleins et treize dates, ce n'est
 * plus une règle, c'est un quadrillage de tableur.
 *
 * On cherche donc le multiple du pas le plus FIN qui tienne encore : entre
 * trois dates et sept, la première qui convient en montant. Le demi-siècle et
 * le siècle arrivent naturellement les premiers, puisque c'est ainsi qu'on
 * situe une famille.
 *
 * Les deux bornes ont chacune coûté un essai. Sans plancher, une famille
 * couvrant cinquante ans se retrouvait avec UNE seule date sur toute la
 * règle : le demi-siècle passait le plafond haut la main, et ne graduait plus
 * rien. Puis, à retenir le plus GROS multiple valable plutôt que le plus fin,
 * deux siècles et demi n'obtenaient que trois dates pour onze graduations —
 * une règle qu'on ne peut plus lire sans compter les traits. Vérifié sur huit
 * étendues, de quarante à huit cents ans.
 */
function labelStep(step: number, span: number): number {
  for (const gros of [step, 50, 100, 200, 500]) {
    if (gros % step !== 0) continue;
    const dates = Math.floor(span / gros) + 1;
    if (dates >= 3 && dates <= 7) return gros;
  }
  return step;
}

/**
 * La famille dans le temps.
 *
 * Une ligne par personne, dans l'ordre des naissances, toutes calées sur le
 * même axe des années : les chevauchements se lisent verticalement, et l'on
 * voit d'un coup d'œil que trois générations vivaient en même temps. Le
 * curseur d'année le montre explicitement.
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
  const viewRef = useGlassScrollSuspend<HTMLElement>();

  const name = (id: string): string => graph.people.get(id)?.displayName ?? id;

  if (timeline.spans.length === 0) {
    return (
      <section className="view view--timeline" aria-label="Chronologie familiale" ref={viewRef}>
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
  const gros = labelStep(step, span);

  const height = Math.max(120, timeline.spans.length * ROW_H + TOP + 22);
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
    <section className="view view--timeline" aria-label="Chronologie familiale" ref={viewRef}>
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
          {/*
            LA RÈGLE DES SIÈCLES.
            
            Un filet horizontal, et les graduations qui y pendent : courtes et
            muettes pour le pas courant, longues et chiffrées pour le
            demi-siècle ou le siècle. Seules ces dernières prolongent leur
            trait sur toute la hauteur, et très pâle — un repère qu'on suit du
            regard quand on en a besoin, pas un quadrillage qu'on subit.
          */}
          <line
            className="timeline-rule"
            x1={LEFT}
            y1={TOP - 8}
            x2={xOf(to)}
            y2={TOP - 8}
          />
          {ticks.map((value) => {
            const porte = value % gros === 0;
            return (
              <g key={value} className="timeline-tick" data-porte={porte || undefined}>
                {porte && (
                  <line
                    className="timeline-guide"
                    x1={xOf(value)}
                    y1={TOP - 8}
                    x2={xOf(value)}
                    y2={height - 10}
                  />
                )}
                <line
                  x1={xOf(value)}
                  y1={TOP - 8}
                  x2={xOf(value)}
                  y2={TOP - 8 + (porte ? 11 : 5)}
                />
                {porte && (
                  <text x={xOf(value)} y={TOP - 14}>
                    {value}
                  </text>
                )}
              </g>
            );
          })}

          {year !== null && (
            <line className="timeline-cursor" x1={xOf(year)} y1={TOP - 12} x2={xOf(year)} y2={height - 10} />
          )}

          {timeline.spans.map((life, row) => {
            const y = TOP + row * ROW_H;
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
                <text x={LEFT - 12} y={y + 12} className="timeline-name">
                  {name(life.personId)}
                </text>
                <rect x={x1} y={y} width={x2 - x1} height={15} rx={7.5}
                      data-approximate={life.approximate || undefined}
                      data-open={life.open || undefined} />
                <text x={x2 + 7} y={y + 12} className="timeline-years">
                  {life.birthYear ?? '?'}
                  {life.deathYear ? ` – ${life.deathYear}` : life.open ? ' –' : ''}
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
