import type { FamilyGraph } from '@/domain/graph';
import { availableScopes, scopeLabel, type Scope } from '@/domain/scope';

/**
 * Le sélecteur de périmètre, partagé par les trois vues.
 *
 * Il dit toujours, en clair, de qui l'on est en train de parler : « Famille de
 * Manuel Albertini », « Côté paternel », « Toute la famille ». Sans ça, une
 * carte à trois marqueurs laisse croire que la famille n'a connu que trois
 * lieux, alors qu'on n'en regarde qu'une branche.
 */
export interface ScopeBarProps {
  graph: FamilyGraph;
  focusId: string;
  scope: Scope;
  onChange: (scope: Scope) => void;
  /** Nombre de personnes retenues, affiché tel quel. */
  count: number;
}

const SHORT: Record<string, string> = {
  view: 'Vue actuelle',
  all: 'Toute la famille',
  paternal: 'Côté paternel',
  maternal: 'Côté maternel',
};

export function ScopeBar({ graph, focusId, scope, onChange, count }: ScopeBarProps) {
  const choices = availableScopes(graph, focusId);

  return (
    <div className="scope-bar">
      <div className="scope-choices lg lg--chip">
        {choices.map((choice) => (
          <button
            key={choice.kind}
            type="button"
            className="scope-choice"
            data-active={choice.kind === scope.kind || undefined}
            onClick={() => onChange(choice)}
          >
            {SHORT[choice.kind] ?? choice.kind}
          </button>
        ))}
      </div>
      {/*
        Le périmètre EST le titre de la vue.

        Les vues Carte et Chronologie n'avaient aucun titre de niveau 2 : on
        sautait du H1 de la barre du haut aux H3 des cartes. Un lecteur d'écran
        navigue par titres et tombait sur « Lieux non situés » avant de savoir
        de quelle famille on parlait. Ce libellé répond exactement à cette
        question, autant qu'il en porte le rang.
      */}
      <h2 className="scope-summary">
        <strong>{scopeLabel(graph, focusId, scope)}</strong>
        <span>
          {count} personne{count > 1 ? 's' : ''}
        </span>
      </h2>
    </div>
  );
}
