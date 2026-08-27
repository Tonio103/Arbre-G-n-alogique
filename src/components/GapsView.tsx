import { useEffect, useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import {
  findGaps,
  GAP_STATUS_LABELS,
  loadGapStatus,
  saveGapStatus,
  type Gap,
  type GapStatus,
} from '@/domain/gaps';
import type { Scope } from '@/domain/scope';
import { ScopeBar } from './ScopeBar';

export interface GapsViewProps {
  graph: FamilyGraph;
  focusId: string;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  people: Set<string>;
  /** Ouvre la personne dans l'arbre. */
  onShowInTree: (id: string) => void;
  /** Ouvre directement sa fiche en modification. */
  onEdit: (id: string) => void;
}

const PRIORITY_LABELS = {
  high: 'Priorité élevée',
  medium: 'Priorité moyenne',
  low: 'Priorité faible',
} as const;

const STATUS_ORDER: GapStatus[] = ['todo', 'searching', 'done'];

/*
 * Combien de manques on montre d'emblée.
 *
 * Le périmètre par défaut en compte quatre-vingt-quatre, et « toute la
 * famille » cent soixante-treize. Tout sortir d'un coup donnait près de douze
 * mille pixels de haut : sur téléphone, la liste devenait un couloir sans fin
 * où l'on ne retrouvait rien. On en montre une page, et l'on déplie à la
 * demande — les plus importants étant de toute façon en tête.
 */
const PAGE = 12;

/**
 * Ce qu'on ne sait pas encore.
 *
 * Cette liste ne relève que des absences dans les données actuelles. Elle ne
 * prétend jamais qu'une information existe quelque part, ni qu'elle serait
 * trouvable : elle dit « ce champ est vide », et propose d'aller le remplir.
 */
export function GapsView({
  graph,
  focusId,
  scope,
  onScopeChange,
  people,
  onShowInTree,
  onEdit,
}: GapsViewProps) {
  const gaps = useMemo(() => findGaps(graph, people), [graph, people]);
  const [status, setStatus] = useState<Record<string, GapStatus>>(() => loadGapStatus());
  const [hideDone, setHideDone] = useState(true);
  const [shownCount, setShownCount] = useState(PAGE);

  // Changer de périmètre repart d'une page : on ne garde pas « tout déplié »
  // d'une branche de quinze personnes à la famille entière.
  useEffect(() => setShownCount(PAGE), [people]);

  useEffect(() => saveGapStatus(status), [status]);

  const statusOf = (gap: Gap): GapStatus => status[gap.id] ?? 'todo';
  const cycle = (gap: Gap): void => {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(statusOf(gap)) + 1) % STATUS_ORDER.length];
    setStatus((current) => ({ ...current, [gap.id]: next }));
  };

  const shown = hideDone ? gaps.filter((gap) => statusOf(gap) !== 'done') : gaps;
  const doneCount = gaps.filter((gap) => statusOf(gap) === 'done').length;

  const visible = shown.slice(0, shownCount);
  const remaining = shown.length - visible.length;

  const byPriority = {
    high: visible.filter((gap) => gap.priority === 'high'),
    medium: visible.filter((gap) => gap.priority === 'medium'),
    low: visible.filter((gap) => gap.priority === 'low'),
  };

  return (
    <section className="view view--gaps" aria-label="Informations manquantes">
      <ScopeBar graph={graph} focusId={focusId} scope={scope} onChange={onScopeChange} count={people.size} />

      <header className="gaps-head lg lg--thick">
        <h2>
          {shown.length === 0
            ? 'Rien à compléter dans ce périmètre'
            : `${shown.length} information${shown.length > 1 ? 's' : ''} à compléter`}
        </h2>
        <p className="view-note">
          Relevé uniquement à partir des champs vides des fiches. L’application ne cherche rien
          d’elle-même et ne peut pas savoir si l’information existe ailleurs.
        </p>
        {doneCount > 0 && (
          <label className="gaps-toggle">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(event) => setHideDone(event.target.checked)}
            />
            Masquer les {doneCount} marqué{doneCount > 1 ? 's' : ''} comme complété
            {doneCount > 1 ? 's' : ''}
          </label>
        )}
      </header>

      {(['high', 'medium', 'low'] as const).map((priority) => {
        const list = byPriority[priority];
        if (list.length === 0) return null;
        return (
          <div key={priority} className="gaps-group">
            <h3 className="gaps-group-title" data-priority={priority}>
              {PRIORITY_LABELS[priority]} <em>{list.length}</em>
            </h3>
            <ul className="gaps-list">
              {list.map((gap) => {
                const state = statusOf(gap);
                return (
                  <li key={gap.id} className="gap-card lg lg--thick" data-status={state}>
                    <button
                      type="button"
                      className="gap-status"
                      data-status={state}
                      onClick={() => cycle(gap)}
                      title="Changer le suivi de recherche"
                    >
                      <span className="gap-dot" aria-hidden="true" />
                      {GAP_STATUS_LABELS[state]}
                    </button>

                    <div className="gap-body">
                      <p className="gap-title">{gap.title}</p>
                      {gap.note && <p className="gap-note">{gap.note}</p>}
                    </div>

                    <div className="gap-actions">
                      <button type="button" onClick={() => onShowInTree(gap.personId)}>
                        Voir dans l’arbre
                      </button>
                      {gap.editable && (
                        <button type="button" onClick={() => onEdit(gap.personId)}>
                          Modifier
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {remaining > 0 && (
        <button
          type="button"
          className="gaps-more lg lg--chip"
          onClick={() => setShownCount((count) => count + PAGE * 2)}
        >
          Voir {Math.min(remaining, PAGE * 2)} de plus
          <em>{remaining} restants</em>
        </button>
      )}

      <p className="view-note view-note--standalone">
        Le suivi 🔴 🟡 🟢 n’est qu’un pense-bête : il ne touche jamais aux données familiales.
        Il est gardé dans ce navigateur, sur cet appareil uniquement.
      </p>
    </section>
  );
}
