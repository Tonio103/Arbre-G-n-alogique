import { memo } from 'react';
import type { Person } from '@/data/schema';
import type { RelationRole } from '@/domain/relations';
import { formatLifespan } from '@/domain/dates';
import { Avatar } from './Avatar';
import { CARD_HEIGHT, CARD_WIDTH } from '@/view/metrics';

export type NodeDetail = 'full' | 'compact';

export interface PersonNodeProps {
  person: Person;
  x: number;
  y: number;
  detail: NodeDetail;
  role?: RelationRole;
  /** Une sélection est active et cette personne n'en fait pas partie. */
  dimmed: boolean;
  selected: boolean;
  /** Résultat de recherche courant : pastille d'attention. */
  flagged: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

function buildAriaLabel(person: Person): string {
  const parts = [person.displayName];
  const lifespan = formatLifespan(person.birthDate, person.deathDate);
  if (lifespan) parts.push(lifespan);
  if (person.profession) parts.push(person.profession);
  return parts.join(', ');
}

/**
 * Carte d'une personne dans l'arbre.
 *
 * Mémoïsée et pilotée par CSS pour le survol : sur un arbre de plusieurs
 * centaines de personnes, seul le changement de sélection doit provoquer un
 * nouveau rendu.
 */
export const PersonNode = memo(function PersonNode({
  person,
  x,
  y,
  detail,
  role,
  dimmed,
  selected,
  flagged,
  onSelect,
  onHover,
}: PersonNodeProps) {
  const lifespan = formatLifespan(person.birthDate, person.deathDate);
  const compact = detail === 'compact';

  return (
    <button
      type="button"
      className="node"
      style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
      data-detail={detail}
      data-role={role ?? undefined}
      data-dimmed={dimmed || undefined}
      data-selected={selected || undefined}
      data-flagged={flagged || undefined}
      data-deceased={!person.living || undefined}
      aria-label={buildAriaLabel(person)}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(person.id);
      }}
      onPointerEnter={() => onHover(person.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(person.id)}
      onBlur={() => onHover(null)}
    >
      <span className="node-surface" aria-hidden="true" />

      <Avatar
        id={person.id}
        initials={person.initials}
        photo={person.photo}
        size={compact ? 64 : 72}
        className="node-avatar"
      />

      <span className="node-text">
        <span className="node-first">{person.firstName}</span>
        {!compact && <span className="node-last">{person.lastName}</span>}
      </span>

      {!compact && lifespan && <span className="node-years">{lifespan}</span>}

      {!compact && (
        <span className="node-tooltip lg lg--clear" aria-hidden="true">
          <span className="node-tooltip-name">{person.displayName}</span>
          {person.birthName && <span className="node-tooltip-line">née {person.maidenName}</span>}
          {lifespan && <span className="node-tooltip-line">{lifespan}</span>}
          {person.headline && <span className="node-tooltip-line">{person.headline}</span>}
          {person.birthPlace && <span className="node-tooltip-line">{person.birthPlace}</span>}
        </span>
      )}
    </button>
  );
});
