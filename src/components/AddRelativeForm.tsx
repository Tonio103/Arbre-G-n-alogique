import { useMemo, useState, type FormEvent } from 'react';
import type { UnionStatus } from '@/data/schema';
import type { NewPersonInput } from '@/domain/edit';
import { normalizeText } from '@/domain/text';
import { UnionFields } from './UnionFields';

export type RelativeKind = 'parent' | 'spouse' | 'child';

export interface AddRelativeFormProps {
  kind: RelativeKind;
  /** Conjoint·es existant·es, pour choisir l'autre parent d'un enfant. */
  spouseOptions?: Array<{ id: string; name: string }>;
  /** Personnes de l'arbre qu'on peut relier telles quelles — voir le mode
   *  « Personne existante » plus bas. Déjà filtrées par l'appelant : ni la
   *  personne concernée, ni quelqu'un déjà dans ce rôle précis. */
  candidates: Array<{ id: string; name: string }>;
  onSubmit: (input: NewPersonInput, otherParentId: string | null, union?: { status: UnionStatus; since?: string; place?: string }) => void;
  /** Relie une personne déjà existante plutôt que d'en créer une. */
  onLink: (existingId: string, otherParentId: string | null, union?: { status: UnionStatus; since?: string; place?: string }) => void;
  onCancel: () => void;
}

const TITLES: Record<RelativeKind, string> = {
  parent: 'Ajouter un parent',
  spouse: 'Ajouter un·e conjoint·e',
  child: 'Ajouter un enfant',
};

/**
 * Nouvelle personne, ou lien vers une fiche qui existe déjà.
 *
 * Le premier cas est de loin le plus courant — une naissance, une union qu'on
 * découvre — et reste volontairement minimal : le nom et une date suffisent,
 * le reste se complète ensuite depuis la fiche elle-même, en « Modifier ».
 *
 * Le second sert un cas différent : deux enfants qui partagent un second
 * parent déjà saisi ailleurs, ou un couple dont l'un des deux a sa propre
 * fiche dans une autre branche. Sans lui, la seule façon d'exprimer ce lien
 * aurait été de ressaisir cette personne sous un second identifiant — et
 * l'arbre se serait mis à raconter deux personnes là où il n'y en a qu'une.
 */
export function AddRelativeForm({ kind, spouseOptions, candidates, onSubmit, onLink, onCancel }: AddRelativeFormProps) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [otherParentId, setOtherParentId] = useState<string>(spouseOptions?.[0]?.id ?? '');
  const [unionStatus, setUnionStatus] = useState<UnionStatus>('married');
  const [unionSince, setUnionSince] = useState('');
  const [unionPlace, setUnionPlace] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = normalizeText(query.trim());
    const pool = term.length === 0 ? candidates : candidates.filter((c) => normalizeText(c.name).includes(term));
    return pool.slice(0, 40);
  }, [candidates, query]);

  const union =
    kind === 'spouse'
      ? { status: unionStatus, since: unionSince.trim() || undefined, place: unionPlace.trim() || undefined }
      : undefined;

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (mode === 'existing') {
      if (!selectedId) return;
      onLink(selectedId, kind === 'child' ? otherParentId || null : null, union);
      return;
    }
    if (!firstName.trim()) return;
    const input: NewPersonInput = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      gender: gender ? (gender as NewPersonInput['gender']) : undefined,
      birthDate: birthDate.trim() || undefined,
    };
    onSubmit(input, kind === 'child' ? otherParentId || null : null, union);
  };

  return (
    <form className="edit-form relative-form" onSubmit={handleSubmit}>
      <h4 className="detail-subtitle">{TITLES[kind]}</h4>

      {candidates.length > 0 && (
        <div className="relative-mode" role="radiogroup" aria-label="Nouvelle personne ou personne existante">
          <button
            type="button"
            className="relative-mode-option"
            data-on={mode === 'new' || undefined}
            onClick={() => setMode('new')}
          >
            Nouvelle personne
          </button>
          <button
            type="button"
            className="relative-mode-option"
            data-on={mode === 'existing' || undefined}
            onClick={() => setMode('existing')}
          >
            Personne existante
          </button>
        </div>
      )}

      {mode === 'new' ? (
        <>
          <div className="edit-form-row edit-form-row--split">
            <label className="edit-field">
              <span>Prénom</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
            </label>
            <label className="edit-field">
              <span>Nom</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>

          <div className="edit-form-row edit-form-row--split">
            <label className="edit-field">
              <span>Genre</span>
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">Non précisé</option>
                <option value="f">Féminin</option>
                <option value="m">Masculin</option>
                <option value="x">Autre</option>
              </select>
            </label>
            <label className="edit-field">
              <span>Naissance</span>
              <input value={birthDate} onChange={(e) => setBirthDate(e.target.value)} placeholder="1980, vers 1980…" />
            </label>
          </div>
        </>
      ) : (
        <div className="edit-field">
          <span>Rechercher</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Un nom déjà dans l’arbre…"
            autoFocus
          />
          <ul className="relative-candidates scroll-area">
            {filtered.length === 0 ? (
              <li className="relative-candidates-empty">Aucune correspondance.</li>
            ) : (
              filtered.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="relative-candidate"
                    data-selected={selectedId === candidate.id || undefined}
                    onClick={() => setSelectedId(candidate.id)}
                  >
                    {candidate.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {kind === 'child' && spouseOptions && spouseOptions.length > 0 && (
        <label className="edit-field">
          <span>Avec</span>
          <select value={otherParentId} onChange={(e) => setOtherParentId(e.target.value)}>
            <option value="">Parent inconnu</option>
            {spouseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {kind === 'spouse' && (
        <UnionFields
          value={{ status: unionStatus, since: unionSince, place: unionPlace }}
          onChange={(next) => {
            setUnionStatus(next.status);
            setUnionSince(next.since);
            setUnionPlace(next.place);
          }}
        />
      )}

      <div className="edit-form-actions">
        <button type="submit" className="action-button action-button--confirm" disabled={mode === 'existing' && !selectedId}>
          {mode === 'existing' ? 'Relier' : 'Ajouter'}
        </button>
        <button type="button" className="action-button" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
