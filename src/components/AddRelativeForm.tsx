import { useState, type FormEvent } from 'react';
import type { UnionStatus } from '@/data/schema';
import type { NewPersonInput } from '@/domain/edit';

export type RelativeKind = 'parent' | 'spouse' | 'child';

export interface AddRelativeFormProps {
  kind: RelativeKind;
  /** Conjoint·es existant·es, pour choisir l'autre parent d'un enfant. */
  spouseOptions?: Array<{ id: string; name: string }>;
  onSubmit: (input: NewPersonInput, otherParentId: string | null, union?: { status: UnionStatus; since?: string; place?: string }) => void;
  onCancel: () => void;
}

const TITLES: Record<RelativeKind, string> = {
  parent: 'Ajouter un parent',
  spouse: 'Ajouter un·e conjoint·e',
  child: 'Ajouter un enfant',
};

/**
 * Volontairement minimal : le nom et une date suffisent à planter quelqu'un
 * dans l'arbre au bon endroit. Le reste (profession, biographie…) se
 * complète ensuite depuis sa propre fiche, en « Modifier » — pas de raison
 * de tout demander avant même que la personne existe.
 */
export function AddRelativeForm({ kind, spouseOptions, onSubmit, onCancel }: AddRelativeFormProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [otherParentId, setOtherParentId] = useState<string>(spouseOptions?.[0]?.id ?? '');
  const [unionStatus, setUnionStatus] = useState<UnionStatus>('married');
  const [unionSince, setUnionSince] = useState('');
  const [unionPlace, setUnionPlace] = useState('');

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!firstName.trim()) return;
    const input: NewPersonInput = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      gender: gender ? (gender as NewPersonInput['gender']) : undefined,
      birthDate: birthDate.trim() || undefined,
    };
    if (kind === 'spouse') {
      onSubmit(input, null, { status: unionStatus, since: unionSince.trim() || undefined, place: unionPlace.trim() || undefined });
    } else if (kind === 'child') {
      onSubmit(input, otherParentId || null);
    } else {
      onSubmit(input, null);
    }
  };

  return (
    <form className="edit-form relative-form" onSubmit={handleSubmit}>
      <h4 className="detail-subtitle">{TITLES[kind]}</h4>

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
        <div className="edit-form-row edit-form-row--split">
          <label className="edit-field">
            <span>Statut</span>
            <select value={unionStatus} onChange={(e) => setUnionStatus(e.target.value as UnionStatus)}>
              <option value="married">Marié·es</option>
              <option value="partner">En couple</option>
              <option value="engaged">Fiancé·es</option>
              <option value="divorced">Divorcé·es</option>
              <option value="widowed">Veuf·ve</option>
              <option value="unknown">Non précisé</option>
            </select>
          </label>
          <label className="edit-field">
            <span>Depuis</span>
            <input value={unionSince} onChange={(e) => setUnionSince(e.target.value)} placeholder="1925…" />
          </label>
        </div>
      )}
      {kind === 'spouse' && (
        <label className="edit-field">
          <span>Lieu d’union</span>
          <input value={unionPlace} onChange={(e) => setUnionPlace(e.target.value)} />
        </label>
      )}

      <div className="edit-form-actions">
        <button type="submit" className="action-button data-panel-confirm">
          Ajouter
        </button>
        <button type="button" className="action-button" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
