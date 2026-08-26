import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { Person, PersonRecord, UnionStatus } from '@/data/schema';
import { computeCurrentAge, formatDate } from '@/domain/dates';
import { ancestorsOf, describeRelationship, descendantsOf, type RelationPath } from '@/domain/relations';
import { lifeTrace } from '@/domain/timeline';
import type { NewPersonInput } from '@/domain/edit';
import { Avatar } from './Avatar';
import { RelationList } from './PersonRelations';
import { PersonEditForm } from './PersonEditForm';
import { RelationEditor } from './RelationEditor';
import { AddRelativeForm, type RelativeKind } from './AddRelativeForm';
import { AddPersonIcon, CloseIcon, EditIcon, HomeIcon, PeopleIcon, PinIcon } from './icons';

export interface DetailPanelProps {
  graph: FamilyGraph;
  person: Person | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onCenter: () => void;
  /** Personne de référence : la fiche dit ce qu'elle est pour elle. */
  anchorId: string | null;
  /** Désigne cette personne comme repère, ou l'en retire. */
  onToggleAnchor: () => void;
  /** Passe en mise en évidence de toute la lignée. */
  onShowLineage: () => void;
  lineageActive: boolean;
  /** Chemin de parenté entre le repère et cette personne, s'il existe. */
  relation?: RelationPath;
  onUpdatePerson: (record: PersonRecord) => void;
  onDeletePerson: (id: string) => void;
  onAddParent: (input: NewPersonInput) => void;
  onAddSpouse: (input: NewPersonInput, union?: { status: UnionStatus; since?: string; place?: string }) => void;
  onAddChild: (input: NewPersonInput, otherParentId: string | null) => void;
  /** Les mêmes gestes, mais vers une personne qui a déjà sa propre fiche. */
  onLinkParent: (parentId: string) => void;
  onLinkSpouse: (spouseId: string, union?: { status: UnionStatus; since?: string; place?: string }) => void;
  onLinkChild: (childId: string, otherParentId: string | null) => void;
  /** Défait un lien sans supprimer aucune des deux fiches. */
  onDetachParent: (parentId: string) => void;
  onDetachSpouse: (spouseId: string) => void;
  onDetachChild: (childId: string) => void;
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
  anchorId,
  onToggleAnchor,
  relation,
  onUpdatePerson,
  onDeletePerson,
  onAddParent,
  onAddSpouse,
  onAddChild,
  onLinkParent,
  onLinkSpouse,
  onLinkChild,
  onDetachParent,
  onDetachSpouse,
  onDetachChild,
}: DetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [addingRelative, setAddingRelative] = useState<RelativeKind | null>(null);

  /*
   * Qui peut être relié tel quel, pour ce rôle précis.
   *
   * Toujours soi-même exclu, et déjà exclu ce qui rendrait le lien
   * redondant (un parent déjà enregistré) ou impossible (son propre
   * descendant comme parent, son propre ascendant comme enfant) — la
   * validation plus fine (dates, cohérence d'ensemble) reste au bandeau
   * d'anomalies, comme pour tout le reste de l'arbre.
   */
  const relativeCandidates = useMemo(() => {
    if (!person || !addingRelative) return [];
    const exclude = new Set<string>([person.id]);
    if (addingRelative === 'parent') {
      for (const id of person.parents) exclude.add(id);
      for (const id of descendantsOf(graph, person.id).keys()) exclude.add(id);
    } else if (addingRelative === 'spouse') {
      for (const link of person.spouseLinks) exclude.add(link.id);
    } else {
      for (const id of person.children) exclude.add(id);
      for (const id of ancestorsOf(graph, person.id).keys()) exclude.add(id);
    }
    const list: Array<{ id: string; name: string }> = [];
    for (const id of graph.order) {
      if (exclude.has(id)) continue;
      const candidate = graph.people.get(id);
      if (candidate) list.push({ id, name: candidate.displayName });
    }
    return list;
  }, [graph, person, addingRelative]);
  // Ce que cette personne est pour le point de repère, en toutes lettres.
  const kinship = useMemo(() => {
    if (!anchorId || !person || anchorId === person.id) return undefined;
    const anchor = graph.people.get(anchorId);
    const label = describeRelationship(graph, anchorId, person.id);
    if (!anchor || !label) return undefined;
    return `${label} de ${anchor.firstName} ${anchor.lastName}`;
  }, [graph, anchorId, person]);

  // Le parcours de vie, reconstruit à partir de ce que l'on sait déjà de la
  // personne — pas ressaisi à part.
  const trace = useMemo(() => (person ? lifeTrace(graph, person) : []), [graph, person]);

  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Repartir du haut — et hors édition — quand on passe d'une personne à l'autre.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    setEditing(false);
    setAddingRelative(null);
  }, [person?.id]);

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
            {kinship && <p className="detail-kinship">{kinship}</p>}
            {relation && relation.steps.length > 2 && (
              <ol className="detail-path" aria-label="Chemin de parenté">
                {relation.steps.map((step, index) => {
                  const stepPerson = graph.people.get(step.id);
                  if (!stepPerson) return null;
                  return (
                    <li key={step.id}>
                      {index > 0 && (
                        <span className="detail-path-arrow" aria-hidden="true">
                          {step.direction === 'up' ? '↑' : step.direction === 'down' ? '↓' : '–'}
                        </span>
                      )}
                      <button type="button" className="detail-path-step" onClick={() => onSelect(step.id)}>
                        {stepPerson.firstName}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
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
        {/*
          * Le point de repère.
          *
          * « Eugénie Beaumont, 1843 – 1921 » ne dit rien dans un arbre de cinq
          * cents personnes. Une fois quelqu'un désigné — soi, le plus souvent —
          * chaque fiche et chaque résultat de recherche répond enfin à la seule
          * question qu'on se pose vraiment : qui est-ce pour moi ?
          */}
        <button
          type="button"
          className="action-button"
          onClick={onToggleAnchor}
          data-pressed={anchorId === person.id || undefined}
          title={
            anchorId === person.id
              ? 'Cette personne sert de point de repère'
              : 'Situer tout le monde par rapport à cette personne'
          }
        >
          <PinIcon />
          {anchorId === person.id ? 'Repère' : 'Partir d’ici'}
        </button>
        <button
          type="button"
          className="action-button"
          onClick={() => setEditing((value) => !value)}
          data-pressed={editing || undefined}
        >
          <EditIcon />
          Modifier
        </button>
        <span className="detail-generation">Génération {person.generation + 1}</span>
      </div>

      {editing ? (
        <div className="detail-body scroll-area" ref={scrollRef}>
          <PersonEditForm
            person={person}
            onSave={(record) => {
              onUpdatePerson(record);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
            onDelete={() => onDeletePerson(person.id)}
            relationEditor={
              <RelationEditor
                graph={graph}
                person={person}
                onAddParent={onAddParent}
                onAddSpouse={onAddSpouse}
                onAddChild={onAddChild}
                onLinkParent={onLinkParent}
                onLinkSpouse={onLinkSpouse}
                onLinkChild={onLinkChild}
                onDetachParent={onDetachParent}
                onDetachSpouse={onDetachSpouse}
                onDetachChild={onDetachChild}
              />
            }
          />
        </div>
      ) : (
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

        {trace.length > 0 && (
          <Section title="Parcours de vie">
            <ol className="life-trace">
              {trace.map((event) => {
                const content = (
                  <>
                    <span className="life-trace-year">{event.year ?? '—'}</span>
                    <span className="life-trace-label">{event.label}</span>
                    {event.place && <span className="life-trace-place">{event.place}</span>}
                  </>
                );
                return (
                  <li key={event.id} className="life-trace-item" data-kind={event.kind}>
                    <span className="life-trace-dot" aria-hidden="true" />
                    {event.personId ? (
                      <button
                        type="button"
                        className="life-trace-row life-trace-link"
                        onClick={() => onSelect(event.personId!)}
                      >
                        {content}
                      </button>
                    ) : (
                      <span className="life-trace-row">{content}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </Section>
        )}

        {person.biography && (
          <Section title="Biographie">
            <p className="detail-prose">{person.biography}</p>
          </Section>
        )}

        {/*
          * D'où vient cette personne ?
          *
          * Un arbre généalogique ne montre qu'une famille : les conjoints y
          * entrent par le mariage, sans ascendance. Rien ne le disait, et une
          * personne sans parents visibles avait l'air d'être tombée là. Deux
          * lignes suffisent à lever l'ambiguïté — et à distinguer celui qui a
          * épousé la famille de ceux par qui elle commence.
          */}
        {person.parents.length === 0 && (
          <p className="detail-origin">
            {person.generation === 0
              ? 'Souche de la lignée : aucun ascendant connu dans cet arbre.'
              : "Entré·e dans la famille par alliance : ses parents ne figurent pas dans cet arbre."}
          </p>
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

        <Section title="Ajouter un proche">
          {addingRelative ? (
            <AddRelativeForm
              kind={addingRelative}
              spouseOptions={person.spouseLinks.map((link) => {
                const spouse = graph.people.get(link.id);
                return { id: link.id, name: spouse?.displayName ?? link.id };
              })}
              candidates={relativeCandidates}
              onCancel={() => setAddingRelative(null)}
              onSubmit={(input, otherParentId, union) => {
                if (addingRelative === 'parent') onAddParent(input);
                else if (addingRelative === 'spouse') onAddSpouse(input, union);
                else onAddChild(input, otherParentId);
                setAddingRelative(null);
              }}
              onLink={(existingId, otherParentId, union) => {
                if (addingRelative === 'parent') onLinkParent(existingId);
                else if (addingRelative === 'spouse') onLinkSpouse(existingId, union);
                else onLinkChild(existingId, otherParentId);
                setAddingRelative(null);
              }}
            />
          ) : (
            <div className="relative-add-buttons">
              {/* Pas de plafond à deux : une adoption ou une reconnaissance
                  ajoute des parents plutôt qu'elle n'en remplace. */}
              <button type="button" className="action-button" onClick={() => setAddingRelative('parent')}>
                <AddPersonIcon />
                Parent
              </button>
              <button type="button" className="action-button" onClick={() => setAddingRelative('spouse')}>
                <AddPersonIcon />
                Conjoint·e
              </button>
              <button type="button" className="action-button" onClick={() => setAddingRelative('child')}>
                <AddPersonIcon />
                Enfant
              </button>
            </div>
          )}
        </Section>

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
      )}
    </aside>
  );
}
