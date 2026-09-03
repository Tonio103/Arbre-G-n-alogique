import { useMemo, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { Person, UnionStatus } from '@/data/schema';
import type { NewPersonInput } from '@/domain/edit';
import { ancestorsOf, descendantsOf } from '@/domain/relations';
import { AddRelativeForm, type RelativeKind } from './AddRelativeForm';
import { UnionFields, type UnionValue } from './UnionFields';
import { EditIcon } from './icons';

export interface RelationEditorProps {
  graph: FamilyGraph;
  person: Person;
  onAddParent: (input: NewPersonInput) => void;
  onAddSpouse: (input: NewPersonInput, union?: { status: UnionStatus; since?: string; place?: string }) => void;
  onAddChild: (input: NewPersonInput, otherParentId: string | null) => void;
  onLinkParent: (parentId: string) => void;
  onLinkSpouse: (spouseId: string, union?: { status: UnionStatus; since?: string; place?: string }) => void;
  onLinkChild: (childId: string, otherParentId: string | null) => void;
  onDetachParent: (parentId: string) => void;
  onDetachSpouse: (spouseId: string) => void;
  onDetachChild: (childId: string) => void;
  onUpdateUnion: (spouseId: string, union: { status: UnionStatus; since?: string; place?: string }) => void;
}

const SECTION_TITLE: Record<RelativeKind, string> = {
  parent: 'Parents',
  spouse: 'Conjoint·es',
  child: 'Enfants',
};

const ADD_LABEL: Record<RelativeKind, string> = {
  parent: 'Ajouter un parent',
  spouse: 'Ajouter un·e conjoint·e',
  child: 'Ajouter un enfant',
};

const EMPTY_LABEL: Record<RelativeKind, string> = {
  parent: 'Aucun parent renseigné.',
  spouse: 'Aucune union renseignée.',
  child: 'Aucun enfant renseigné.',
};

/**
 * Les liens d'une personne, modifiables sur place.
 *
 * Jusqu'ici on ne pouvait qu'*ajouter* un proche : corriger une filiation
 * fausse, un remariage mal noté ou un conjoint saisi deux fois demandait de
 * supprimer la fiche entière et de la ressaisir — en perdant tout ce qu'elle
 * contenait. Chaque lien porte donc maintenant son propre retrait, qui défait
 * le lien sans toucher aux deux personnes qu'il reliait.
 *
 * Le nombre de parents n'est pas plafonné : une adoption ou une
 * reconnaissance en ajoute aux parents de naissance plutôt qu'elle ne les
 * remplace (voir `schema.ts`).
 */
export function RelationEditor({
  graph,
  person,
  onAddParent,
  onAddSpouse,
  onAddChild,
  onLinkParent,
  onLinkSpouse,
  onLinkChild,
  onDetachParent,
  onDetachSpouse,
  onDetachChild,
  onUpdateUnion,
}: RelationEditorProps) {
  const [adding, setAdding] = useState<RelativeKind | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Le conjoint dont on corrige l'union — statut, date, lieu — en ce moment.
  const [editingUnion, setEditingUnion] = useState<string | null>(null);

  const spouseIds = person.spouseLinks.map((link) => link.id);

  /** Qui peut être relié dans ce rôle — mêmes garde-fous que dans la fiche :
   *  ni soi-même, ni un lien déjà posé, ni de quoi créer un cycle. */
  const candidates = useMemo(() => {
    if (!adding) return [];
    const exclude = new Set<string>([person.id]);
    if (adding === 'parent') {
      for (const id of person.parents) exclude.add(id);
      for (const id of descendantsOf(graph, person.id).keys()) exclude.add(id);
    } else if (adding === 'spouse') {
      for (const id of spouseIds) exclude.add(id);
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
  }, [graph, person, adding, spouseIds]);

  const rows: Array<{ kind: RelativeKind; ids: string[]; detach: (id: string) => void }> = [
    { kind: 'parent', ids: person.parents, detach: onDetachParent },
    { kind: 'spouse', ids: spouseIds, detach: onDetachSpouse },
    { kind: 'child', ids: person.children, detach: onDetachChild },
  ];

  const [unionDraft, setUnionDraft] = useState<UnionValue>({
    status: 'married',
    since: '',
    place: '',
  });

  const startEditingUnion = (id: string): void => {
    const link = person.spouseLinks.find((l) => l.id === id);
    setUnionDraft({
      status: link?.status ?? 'married',
      since: link?.since ? String(link.since) : '',
      place: link?.place ?? '',
    });
    setEditingUnion(id);
  };

  return (
    <div className="relation-editor">
      {rows.map(({ kind, ids, detach }) => (
        <div className="relation-editor-group" key={kind}>
          <h4 className="detail-subtitle">
            {SECTION_TITLE[kind]}
            {ids.length > 0 && <span className="detail-section-count">{ids.length}</span>}
          </h4>

          {ids.length === 0 ? (
            <p className="relation-editor-empty">{EMPTY_LABEL[kind]}</p>
          ) : (
            <ul className="relation-editor-list">
              {ids.map((id) => {
                const other = graph.people.get(id);
                if (!other) return null;
                const token = `${kind}:${id}`;
                const link = kind === 'spouse' ? person.spouseLinks.find((l) => l.id === id) : undefined;
                const isEditingUnion = kind === 'spouse' && editingUnion === id;
                return (
                  <li key={id} className="relation-editor-item" data-expanded={isEditingUnion || undefined}>
                    <div className="relation-editor-row">
                      <span className="relation-editor-name">
                        {other.displayName}
                        {link?.since && (
                          <span className="relation-editor-note">depuis {String(link.since).slice(0, 4)}</span>
                        )}
                      </span>
                      {confirming === token ? (
                        <span className="relation-editor-confirm">
                          <button
                            type="button"
                            className="relation-editor-danger"
                            onClick={() => {
                              detach(id);
                              setConfirming(null);
                            }}
                          >
                            Retirer le lien
                          </button>
                          <button
                            type="button"
                            className="relation-editor-cancel"
                            onClick={() => setConfirming(null)}
                          >
                            Annuler
                          </button>
                        </span>
                      ) : (
                        <span className="relation-editor-actions">
                          {kind === 'spouse' && (
                            <button
                              type="button"
                              className="relation-editor-edit"
                              aria-label={`Modifier l’union avec ${other.displayName}`}
                              title="Statut, date, lieu de l’union"
                              aria-pressed={isEditingUnion}
                              onClick={() =>
                                isEditingUnion ? setEditingUnion(null) : startEditingUnion(id)
                              }
                            >
                              <EditIcon />
                            </button>
                          )}
                          <button
                            type="button"
                            className="relation-editor-remove"
                            aria-label={`Retirer le lien avec ${other.displayName}`}
                            title="Retirer ce lien — les deux fiches sont conservées"
                            onClick={() => setConfirming(token)}
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </div>

                    {isEditingUnion && (
                      <div className="relation-editor-union">
                        <UnionFields value={unionDraft} onChange={setUnionDraft} />
                        <div className="edit-form-actions">
                          <button
                            type="button"
                            className="action-button action-button--confirm"
                            onClick={() => {
                              onUpdateUnion(id, {
                                status: unionDraft.status,
                                since: unionDraft.since.trim() || undefined,
                                place: unionDraft.place.trim() || undefined,
                              });
                              setEditingUnion(null);
                            }}
                          >
                            Enregistrer
                          </button>
                          <button
                            type="button"
                            className="action-button"
                            onClick={() => setEditingUnion(null)}
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {adding === kind ? (
            <AddRelativeForm
              kind={kind}
              spouseOptions={person.spouseLinks.map((link) => ({
                id: link.id,
                name: graph.people.get(link.id)?.displayName ?? link.id,
              }))}
              candidates={candidates}
              onCancel={() => setAdding(null)}
              onSubmit={(input, otherParentId, union) => {
                if (kind === 'parent') onAddParent(input);
                else if (kind === 'spouse') onAddSpouse(input, union);
                else onAddChild(input, otherParentId);
                setAdding(null);
              }}
              onLink={(existingId, otherParentId, union) => {
                if (kind === 'parent') onLinkParent(existingId);
                else if (kind === 'spouse') onLinkSpouse(existingId, union);
                else onLinkChild(existingId, otherParentId);
                setAdding(null);
              }}
            />
          ) : (
            <button type="button" className="edit-list-add" onClick={() => setAdding(kind)}>
              + {ADD_LABEL[kind]}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
