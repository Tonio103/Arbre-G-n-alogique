import { memo } from 'react';
import type React from 'react';
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
  /**
   * Rang de la lignée fondatrice, qui donne sa teinte à la carte.
   *
   * Réparti par l'angle d'or : deux rangs consécutifs tombent à 137,5° l'un de
   * l'autre sur le cercle des teintes, ce qui donne des couleurs franchement
   * distinctes quel que soit leur nombre — là où un pas régulier finit par
   * rapprocher les dernières.
   */
  /** Cette personne fait partie du chemin de parenté affiché. */
  onPath?: boolean;
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
 * Médaillon d'une personne.
 *
 * Un portrait rond et un nom, sans cadre : sur un arbre, une grille de
 * rectangles écraserait la ramure qu'elle est censée habiter. Le verre
 * n'apparaît qu'au survol et à la sélection, là où il aide à lire.
 *
 * Mémoïsé et piloté par CSS pour le survol : sur un arbre de plusieurs
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
  onPath,
  onSelect,
  onHover,
}: PersonNodeProps) {
  const lifespan = formatLifespan(person.birthDate, person.deathDate);
  const compact = detail === 'compact';

  return (
    <button
      type="button"
      className="node"
      style={
        {
          left: x,
          top: y,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
        } as React.CSSProperties
      }
      data-id={person.id}
      data-path={onPath || undefined}
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
      {/* Halo posé derrière le portrait : il détache le médaillon du feuillage
          sans lui imposer de cadre. */}
      <span className="node-halo" aria-hidden="true" />

      <span className="node-portrait">
        <Avatar
          id={person.id}
          initials={person.initials}
          photo={person.photo}
          size={compact ? 44 : 50}
          className="node-avatar"
        />
        <span className="node-ring" aria-hidden="true" />
      </span>

      <span className="node-plate lg lg--plate">
        <span className="node-first">{person.firstName}</span>
        {!compact && <span className="node-last">{person.lastName}</span>}
        {!compact && lifespan && <span className="node-years">{lifespan}</span>}
      </span>

      {!compact && (
        <span className="node-tooltip lg lg--clear" aria-hidden="true">
          <span className="node-tooltip-name">{person.displayName}</span>
          {person.birthName && <span className="node-tooltip-line">née {person.maidenName}</span>}
          {person.parents.length === 0 && (
            <span className="node-tooltip-line">
              {person.generation === 0 ? 'Souche de la lignée' : 'Entré·e par alliance'}
            </span>
          )}
          {lifespan && <span className="node-tooltip-line">{lifespan}</span>}
          {person.headline && <span className="node-tooltip-line">{person.headline}</span>}
          {person.birthPlace && <span className="node-tooltip-line">{person.birthPlace}</span>}
        </span>
      )}
    </button>
  );
});
