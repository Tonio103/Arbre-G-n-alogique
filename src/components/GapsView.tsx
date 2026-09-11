import { useEffect, useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import { useGlassScrollSuspend } from '@/hooks/useGlassScrollSuspend';
import {
  findGaps,
  GAP_STATUS_LABELS,
  loadGapStatus,
  saveGapStatus,
  type Gap,
  type GapStatus,
} from '@/domain/gaps';
import { questionsAPoser, messagePour } from '@/domain/questions';
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
  /**
   * Qui regarde, s'il s'est désigné dans l'arbre.
   *
   * Sert à ne pas lui proposer de s'écrire un message à lui-même : ses
   * questions repartent alors vers le parent vivant suivant.
   */
  moi?: string | null;
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
  moi,
}: GapsViewProps) {
  const gaps = useMemo(() => findGaps(graph, people), [graph, people]);

  /*
   * DEUX LECTURES DU MÊME RELEVÉ.
   *
   * « Par manque » range des champs vides par importance. C'est juste, et
   * parfaitement inerte : personne ne se lève pour aller consulter un
   * registre. « À qui demander » prend exactement les mêmes manques et
   * répond à la seule question qui déclenche quelque chose — un arbre se
   * remplit en demandant à sa tante, pas en cherchant.
   *
   * Le même relevé, donc, et pas un second calcul : `questionsAPoser` reçoit
   * `gaps` tout fait. Deux relevés qui pourraient diverger d'un manque
   * seraient deux vérités sur la même famille.
   */
  const [lecture, setLecture] = useState<'manques' | 'demander'>('manques');
  const interlocuteurs = useMemo(
    () => questionsAPoser(graph, people, { moi }, gaps),
    [graph, people, moi, gaps],
  );
  const [copie, setCopie] = useState<string | null>(null);
  /* Quatre-vingt-dix-huit interlocuteurs sur la famille entière : la liste
     doit se borner comme celle des manques, sans quoi on la fait défiler sans
     jamais en voir le bout. */
  const [montres, setMontres] = useState(PAGE);
  const [status, setStatus] = useState<Record<string, GapStatus>>(() => loadGapStatus());
  const [hideDone, setHideDone] = useState(true);
  const [shownCount, setShownCount] = useState(PAGE);

  // Changer de périmètre repart d'une page : on ne garde pas « tout déplié »
  // d'une branche de quinze personnes à la famille entière.
  useEffect(() => {
    setShownCount(PAGE);
    setMontres(PAGE);
  }, [people]);

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

  const viewRef = useGlassScrollSuspend<HTMLElement>();

  const byPriority = {
    high: visible.filter((gap) => gap.priority === 'high'),
    medium: visible.filter((gap) => gap.priority === 'medium'),
    low: visible.filter((gap) => gap.priority === 'low'),
  };

  return (
    <section className="view view--gaps" aria-label="Informations manquantes" ref={viewRef}>
      <ScopeBar graph={graph} focusId={focusId} scope={scope} onChange={onScopeChange} count={people.size} />

      <header className="gaps-head">
        <div className="gaps-lecture">
          <button
            type="button"
            data-actif={lecture === 'manques' || undefined}
            onClick={() => setLecture('manques')}
          >
            Par manque
          </button>
          <button
            type="button"
            data-actif={lecture === 'demander' || undefined}
            onClick={() => setLecture('demander')}
          >
            À qui demander
          </button>
        </div>

        <h3>
          {shown.length === 0
            ? 'Rien à compléter dans ce périmètre'
            : `${shown.length} information${shown.length > 1 ? 's' : ''} à compléter`}
        </h3>
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

      {lecture === 'demander' &&
        interlocuteurs.slice(0, montres).map((interlocuteur) => (
          <div key={interlocuteur.id ?? 'sans'} className="gaps-group">
            <h4 className="demander-tete">
              {interlocuteur.id ? (
                <button type="button" onClick={() => onShowInTree(interlocuteur.id!)}>
                  {interlocuteur.nom}
                </button>
              ) : (
                <span className="demander-sans">{interlocuteur.nom}</span>
              )}
              <em>{interlocuteur.questions.length}</em>
            </h4>

            <ul className="demander-liste">
              {interlocuteur.questions.map((question) => (
                <li key={question.gapId}>
                  <button type="button" onClick={() => onShowInTree(question.sujetId)}>
                    {question.texte}
                  </button>
                </li>
              ))}
            </ul>

            {/*
              LE BOUTON QUI FAIT TOUT.
              Une liste qu'on peut lire ne fait rien arriver ; une liste qu'on
              peut envoyer, si. C'est la seule raison d'être de cette lecture.
            */}
            {interlocuteur.id && (
              <button
                type="button"
                className="demander-copier"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(messagePour(interlocuteur, graph.title, graph))
                    .then(() => setCopie(interlocuteur.id))
                    .catch(() => setCopie(null));
                }}
              >
                {copie === interlocuteur.id ? 'Message copié' : 'Copier le message'}
              </button>
            )}
          </div>
        ))}

      {lecture === 'demander' && interlocuteurs.length > montres && (
        <button
          type="button"
          className="gaps-more"
          onClick={() => setMontres((compte) => compte + PAGE * 2)}
        >
          Voir {Math.min(interlocuteurs.length - montres, PAGE * 2)} personnes de plus
          <em>{interlocuteurs.length - montres} restantes</em>
        </button>
      )}

      {lecture === 'demander' && interlocuteurs.length === 0 && (
        <p className="view-empty lg lg--thick">
          Rien à demander dans ce périmètre : toutes les fiches sont complètes.
        </p>
      )}

      {lecture === 'manques' &&
        (['high', 'medium', 'low'] as const).map((priority) => {
        const list = byPriority[priority];
        if (list.length === 0) return null;
        return (
          <div key={priority} className="gaps-group">
            <h4 className="gaps-group-title" data-priority={priority}>
              {PRIORITY_LABELS[priority]} <em>{list.length}</em>
            </h4>
            <ul className="gaps-list">
              {list.map((gap) => {
                const state = statusOf(gap);
                return (
                  <li key={gap.id} className="gap-card" data-status={state}>
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

      {lecture === 'manques' && remaining > 0 && (
        <button
          type="button"
          className="gaps-more"
          onClick={() => setShownCount((count) => count + PAGE * 2)}
        >
          Voir {Math.min(remaining, PAGE * 2)} de plus
          <em>{remaining} restants</em>
        </button>
      )}
    </section>
  );
}
