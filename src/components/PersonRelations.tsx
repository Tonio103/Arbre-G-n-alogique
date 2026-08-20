import { memo } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { SpouseLink, UnionStatus } from '@/data/schema';
import { formatLifespan } from '@/domain/dates';
import { describeRelationship } from '@/domain/relations';
import { Avatar } from './Avatar';

const STATUS_LABEL: Record<UnionStatus, string> = {
  married: 'Mariés',
  partner: 'En couple',
  divorced: 'Divorcés',
  widowed: 'Veuvage',
  engaged: 'Fiancés',
  unknown: '',
};

export interface RelationListProps {
  graph: FamilyGraph;
  focusId: string;
  ids: string[];
  onSelect: (id: string) => void;
  /** Statuts d'union, indexés par identifiant de conjoint. */
  spouseLinks?: SpouseLink[];
  emptyLabel?: string;
}

/** Liste de proches cliquables : c'est le principal moyen de circuler dans l'arbre. */
export const RelationList = memo(function RelationList({
  graph,
  focusId,
  ids,
  onSelect,
  spouseLinks,
  emptyLabel,
}: RelationListProps) {
  if (ids.length === 0) {
    return emptyLabel ? <p className="detail-empty">{emptyLabel}</p> : null;
  }

  return (
    <ul className="relation-list">
      {ids.map((id) => {
        const person = graph.people.get(id);
        if (!person) return null;
        const lifespan = formatLifespan(person.birthDate, person.deathDate);
        const relation = describeRelationship(graph, focusId, id);
        const link = spouseLinks?.find((entry) => entry.id === id);
        const status = link?.status ? STATUS_LABEL[link.status] : '';
        const detail = [relation, lifespan].filter(Boolean).join(' · ');

        return (
          <li key={id}>
            <button type="button" className="relation" onClick={() => onSelect(id)}>
              <Avatar id={person.id} initials={person.initials} photo={person.photo} size={38} />
              <span className="relation-text">
                <span className="relation-name">{person.displayName}</span>
                <span className="relation-meta">{detail}</span>
              </span>
              {status && link?.since ? (
                <span className="relation-badge">
                  {status} · {String(link.since).slice(0, 4)}
                </span>
              ) : status ? (
                <span className="relation-badge">{status}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
});
