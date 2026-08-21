import { useEffect, useRef, type ReactNode } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { Person } from '@/data/schema';
import { computeCurrentAge, formatDate } from '@/domain/dates';
import { Avatar } from './Avatar';
import { RelationList } from './PersonRelations';
import { CloseIcon, HomeIcon, PeopleIcon } from './icons';

export interface DetailPanelProps {
  graph: FamilyGraph;
  person: Person | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onCenter: () => void;
  /** Passe en mise en évidence de toute la lignée. */
  onShowLineage: () => void;
  lineageActive: boolean;
}

function Section({
  title,
  children,
  count,
}: {
  title: string;
  children: ReactNode;
  count?: number;
}) {
  return (
    <section className="detail-section">
      <h3 className="detail-section-title">
        {title}
        {count !== undefined && count > 0 && <span className="detail-section-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function FactRow({ label, value }: { label: string; value?: ReactNode }) {
  if (!value) return null;
  return (
    <div className="fact">
      <dt className="fact-label">{label}</dt>
      <dd className="fact-value">{value}</dd>
    </div>
  );
}

function Chips({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="chips">
      {items.map((item) => (
        <li key={item} className="chip">
          {item}
        </li>
      ))}
    </ul>
  );
}

function lifeSummary(person: Person): string {
  const birth = person.birthYear;
  if (!birth) return '';
  if (person.living) {
    const age = computeCurrentAge(person.birthDate);
    return age !== undefined ? `${birth} · ${age} ans` : `Né${person.gender === 'f' ? 'e' : ''} en ${birth}`;
  }
  const death = person.deathYear;
  if (death && person.ageAtDeath !== undefined) {
    return `${birth} – ${death} · ${person.ageAtDeath} ans`;
  }
  return death ? `${birth} – ${death}` : `${birth}`;
}

/**
 * Fiche complète d'une personne.
 *
 * Chaque bloc ne s'affiche que si l'information existe : un ancêtre dont on ne
 * connaît que le nom ne doit pas produire une page de champs vides.
 */
export function DetailPanel({
  graph,
  person,
  onSelect,
  onClose,
  onCenter,
  onShowLineage,
  lineageActive,
}: DetailPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Repartir du haut quand on passe d'une personne à l'autre.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [person?.id]);

  useEffect(() => {
    if (!person) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [person, onClose]);

  if (!person) return null;

  const spouseIds = person.spouseLinks.map((link) => link.id);
  const customEntries = Object.entries(person.custom ?? {});
  const summary = lifeSummary(person);

  return (
    <aside
      ref={panelRef}
      className="detail lg lg--thick lg--liquid"
      aria-label={`Fiche de ${person.displayName}`}
      key={person.id}
    >
      <div className="detail-head">
        <div className="detail-identity">
          <Avatar
            id={person.id}
            initials={person.initials}
            photo={person.photo}
            size={78}
            alt={`Portrait de ${person.displayName}`}
          />
          <div className="detail-names">
            <h2 className="detail-name">{person.displayName}</h2>
            {person.birthName && <p className="detail-birthname">née {person.maidenName}</p>}
            {person.nickname && <p className="detail-birthname">dit·e « {person.nickname} »</p>}
            {summary && <p className="detail-summary">{summary}</p>}
            {person.headline && <p className="detail-headline">{person.headline}</p>}
          </div>
        </div>

        <button type="button" className="icon-button detail-close" onClick={onClose} aria-label="Fermer la fiche">
          <CloseIcon />
        </button>
      </div>

      <div className="detail-actions">
        <button type="button" className="action-button" onClick={onCenter}>
          <HomeIcon />
          Centrer
        </button>
        <button
          type="button"
          className="action-button"
          onClick={onShowLineage}
          data-pressed={lineageActive || undefined}
        >
          <PeopleIcon />
          {lineageActive ? 'Famille proche' : 'Toute la lignée'}
        </button>
        <span className="detail-generation">Génération {person.generation + 1}</span>
      </div>

      <div className="detail-body scroll-area" ref={scrollRef}>
        <Section title="État civil">
          <dl className="fact-list">
            <FactRow label="Naissance" value={formatDate(person.birthDate)} />
            <FactRow label="Lieu de naissance" value={person.birthPlace} />
            <FactRow label="Décès" value={formatDate(person.deathDate)} />
            <FactRow label="Lieu de décès" value={person.deathPlace} />
            <FactRow
              label="Âge au décès"
              value={person.ageAtDeath !== undefined ? `${person.ageAtDeath} ans` : undefined}
            />
            <FactRow label="Profession" value={person.profession} />
            <FactRow label="Études" value={person.education} />
            <FactRow
              label={person.residences && person.residences.length > 1 ? 'Lieux de vie' : 'Lieu de vie'}
              value={person.residences?.join(' · ')}
            />
          </dl>
        </Section>

        {person.biography && (
          <Section title="Biographie">
            <p className="detail-prose">{person.biography}</p>
          </Section>
        )}

        {(person.parents.length > 0 ||
          spouseIds.length > 0 ||
          person.children.length > 0 ||
          person.siblings.length > 0 ||
          person.halfSiblings.length > 0) && (
          <Section title="Famille">
            {person.parents.length > 0 && (
              <>
                <h4 className="detail-subtitle">Parents</h4>
                <RelationList graph={graph} focusId={person.id} ids={person.parents} onSelect={onSelect} />
              </>
            )}

            {spouseIds.length > 0 && (
              <>
                <h4 className="detail-subtitle">{spouseIds.length > 1 ? 'Conjoints' : 'Conjoint·e'}</h4>
                <RelationList
                  graph={graph}
                  focusId={person.id}
                  ids={spouseIds}
                  onSelect={onSelect}
                  spouseLinks={person.spouseLinks}
                />
              </>
            )}

            {person.children.length > 0 && (
              <>
                <h4 className="detail-subtitle">
                  Enfants <span className="detail-section-count">{person.children.length}</span>
                </h4>
                <RelationList graph={graph} focusId={person.id} ids={person.children} onSelect={onSelect} />
              </>
            )}

            {person.siblings.length > 0 && (
              <>
                <h4 className="detail-subtitle">
                  Frères et sœurs <span className="detail-section-count">{person.siblings.length}</span>
                </h4>
                <RelationList graph={graph} focusId={person.id} ids={person.siblings} onSelect={onSelect} />
              </>
            )}

            {person.halfSiblings.length > 0 && (
              <>
                <h4 className="detail-subtitle">Demi-frères et demi-sœurs</h4>
                <RelationList
                  graph={graph}
                  focusId={person.id}
                  ids={person.halfSiblings}
                  onSelect={onSelect}
                />
              </>
            )}
          </Section>
        )}

        {person.interests && person.interests.length > 0 && (
          <Section title="Ce qu’elle ou il aimait">
            <Chips items={person.interests} />
          </Section>
        )}

        {person.milestones && person.milestones.length > 0 && (
          <Section title="Événements marquants">
            <ol className="timeline">
              {person.milestones.map((milestone, index) => (
                <li key={`${milestone.title}-${index}`} className="timeline-item">
                  <span className="timeline-year">{milestone.year ?? '—'}</span>
                  <span className="timeline-content">
                    <span className="timeline-title">{milestone.title}</span>
                    {milestone.detail && <span className="timeline-detail">{milestone.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {person.anecdotes && person.anecdotes.length > 0 && (
          <Section title="Anecdotes">
            <ul className="note-list">
              {person.anecdotes.map((anecdote, index) => (
                <li key={index} className="note">
                  {anecdote}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {person.memories && person.memories.length > 0 && (
          <Section title="Souvenirs de famille">
            <ul className="note-list">
              {person.memories.map((memory, index) => (
                <li key={index} className="note note-quote">
                  {memory}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {person.notes && (
          <Section title="Notes">
            <p className="detail-prose">{person.notes}</p>
          </Section>
        )}

        {customEntries.length > 0 && (
          <Section title="Informations complémentaires">
            <dl className="fact-list">
              {customEntries.map(([label, value]) => (
                <FactRow
                  key={label}
                  label={label}
                  value={Array.isArray(value) ? value.join(' · ') : value}
                />
              ))}
            </dl>
          </Section>
        )}

        {person.links && person.links.length > 0 && (
          <Section title="Sources et liens">
            <ul className="link-list">
              {person.links.map((link) => (
                <li key={link.url}>
                  <a className="external-link" href={link.url} target="_blank" rel="noreferrer noopener">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <p className="detail-id">Identifiant : {person.id}</p>
      </div>
    </aside>
  );
}
