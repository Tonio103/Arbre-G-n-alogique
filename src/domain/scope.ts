import type { FamilyGraph } from './graph';
import { ancestorsOf } from './relations';

/*
 * ============================================================================
 *
 *  LE PÉRIMÈTRE
 *
 *  Les vues Carte, Chronologie et À compléter ne parlent jamais de « toute la
 *  base » par défaut : elles parlent de ce que l'arbre montre à l'instant. Si
 *  on regarde la famille du père, la carte ne pointe que ses lieux, la
 *  chronologie que ses dates, la liste que ses manques.
 *
 *  Un seul endroit décide donc de « qui compte », et les trois vues s'y
 *  réfèrent. Sans quoi chacune aurait sa propre idée du périmètre, et on ne
 *  saurait plus ce qu'on est en train de regarder.
 *
 * ==========================================================================*/

export type ScopeKind = 'view' | 'all' | 'paternal' | 'maternal' | 'person' | 'generation';

export interface Scope {
  kind: ScopeKind;
  /** Pour `person` : de qui. */
  personId?: string;
  /** Pour `generation` : laquelle. */
  generation?: number;
}

export const DEFAULT_SCOPE: Scope = { kind: 'view' };

/**
 * Le parent d'un côté donné.
 *
 * « Côté paternel » n'a de sens que si le sexe est renseigné. À défaut, on
 * prend le premier parent pour le côté gauche et le second pour le droit —
 * l'ordre dans lequel l'arbre les dessine — plutôt que de ne rien montrer.
 */
function parentOnSide(
  graph: FamilyGraph,
  personId: string,
  side: 'paternal' | 'maternal',
): string | undefined {
  const parents = (graph.people.get(personId)?.parents ?? []).filter((id) => graph.people.has(id));
  if (parents.length === 0) return undefined;
  const wanted = side === 'paternal' ? 'm' : 'f';
  const matching = parents.find((id) => graph.people.get(id)?.gender === wanted);
  if (matching) return matching;
  if (parents.length < 2) return undefined;
  return side === 'paternal' ? parents[0] : parents[1];
}

/**
 * Qui entre dans le périmètre.
 *
 * `visible` est l'ensemble effectivement dessiné dans l'arbre : c'est lui qui
 * sert de repli, pour que « la vue actuelle » veuille toujours dire ce qu'on a
 * sous les yeux.
 */
export function peopleInScope(
  graph: FamilyGraph,
  focusId: string,
  scope: Scope,
  visible: Iterable<string>,
): Set<string> {
  switch (scope.kind) {
    case 'all':
      return new Set(graph.order);

    case 'paternal':
    case 'maternal': {
      const parentId = parentOnSide(graph, focusId, scope.kind);
      // `ancestorsOf` inclut la personne elle-même (distance 0) : c'est
      // exactement ce qu'on veut ici, le parent faisant partie de son côté.
      return parentId ? new Set(ancestorsOf(graph, parentId).keys()) : new Set<string>();
    }

    case 'person':
      return new Set(scope.personId && graph.people.has(scope.personId) ? [scope.personId] : []);

    case 'generation': {
      const wanted = scope.generation;
      if (wanted === undefined) return new Set(visible);
      return new Set(graph.order.filter((id) => graph.people.get(id)?.generation === wanted));
    }

    case 'view':
    default:
      return new Set(visible);
  }
}

/** Intitulé du périmètre, pour l'afficher tel quel dans chaque vue. */
export function scopeLabel(graph: FamilyGraph, focusId: string, scope: Scope): string {
  const name = (id?: string): string => {
    const person = id ? graph.people.get(id) : undefined;
    return person ? person.displayName : 'cette personne';
  };
  switch (scope.kind) {
    case 'all':
      return 'Toute la famille';
    case 'paternal':
      return `Côté paternel — ${name(parentOnSide(graph, focusId, 'paternal'))}`;
    case 'maternal':
      return `Côté maternel — ${name(parentOnSide(graph, focusId, 'maternal'))}`;
    case 'person':
      return name(scope.personId);
    case 'generation':
      return `Génération ${scope.generation ?? '?'}`;
    case 'view':
    default:
      return `Famille de ${name(focusId)}`;
  }
}

/** Les périmètres proposés, en écartant ceux qui ne mèneraient à personne. */
export function availableScopes(graph: FamilyGraph, focusId: string): Scope[] {
  const list: Scope[] = [{ kind: 'view' }, { kind: 'all' }];
  if (parentOnSide(graph, focusId, 'paternal')) list.push({ kind: 'paternal' });
  if (parentOnSide(graph, focusId, 'maternal')) list.push({ kind: 'maternal' });
  return list;
}
