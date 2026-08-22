import { useState, type FormEvent } from 'react';
import type { Person, PersonRecord } from '@/data/schema';

export interface PersonEditFormProps {
  person: Person;
  onSave: (record: PersonRecord) => void;
  onCancel: () => void;
  onDelete: () => void;
}

interface Field {
  key: keyof PersonRecord;
  label: string;
  placeholder?: string;
  type?: 'text' | 'textarea';
}

const FIELDS: Field[] = [
  { key: 'birthDate', label: 'Naissance', placeholder: '1887, 1887-04-23, vers 1887…' },
  { key: 'birthPlace', label: 'Lieu de naissance' },
  { key: 'deathDate', label: 'Décès' },
  { key: 'deathPlace', label: 'Lieu de décès' },
  { key: 'profession', label: 'Profession' },
  { key: 'education', label: 'Études' },
];

/**
 * Le formulaire ne réécrit que les champs qu'il connaît — tout le reste de
 * la fiche (anecdotes, souvenirs, champs libres…) passe intact d'une
 * sauvegarde à l'autre, saisi ailleurs ou pas du tout selon les cas.
 */
export function PersonEditForm({ person, onSave, onCancel, onDelete }: PersonEditFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {
      firstName: person.firstName,
      lastName: person.lastName,
      biography: person.biography ?? '',
      notes: person.notes ?? '',
    };
    for (const field of FIELDS) initial[field.key] = (person[field.key] as string) ?? '';
    return initial;
  });
  const [gender, setGender] = useState(person.gender ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const set = (key: string, value: string): void => setValues((v) => ({ ...v, [key]: value }));

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const record: PersonRecord = {
      ...person,
      firstName: values.firstName.trim() || person.firstName,
      lastName: values.lastName.trim(),
      gender: gender ? (gender as PersonRecord['gender']) : undefined,
      biography: values.biography.trim() || undefined,
      notes: values.notes.trim() || undefined,
    };
    for (const field of FIELDS) {
      const value = values[field.key]?.trim();
      (record as unknown as Record<string, unknown>)[field.key] = value || undefined;
    }
    onSave(record);
  };

  return (
    <form className="edit-form" onSubmit={handleSubmit}>
      <div className="edit-form-row edit-form-row--split">
        <label className="edit-field">
          <span>Prénom</span>
          <input value={values.firstName} onChange={(e) => set('firstName', e.target.value)} required />
        </label>
        <label className="edit-field">
          <span>Nom</span>
          <input value={values.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </label>
      </div>

      <label className="edit-field">
        <span>Genre</span>
        <select value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Non précisé</option>
          <option value="f">Féminin</option>
          <option value="m">Masculin</option>
          <option value="x">Autre</option>
        </select>
      </label>

      {FIELDS.map((field) => (
        <label className="edit-field" key={field.key}>
          <span>{field.label}</span>
          <input
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => set(field.key, e.target.value)}
          />
        </label>
      ))}

      <label className="edit-field">
        <span>Biographie</span>
        <textarea rows={4} value={values.biography} onChange={(e) => set('biography', e.target.value)} />
      </label>

      <label className="edit-field">
        <span>Notes</span>
        <textarea rows={3} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>

      <div className="edit-form-actions">
        <button type="submit" className="action-button data-panel-confirm">
          Enregistrer
        </button>
        <button type="button" className="action-button" onClick={onCancel}>
          Annuler
        </button>
      </div>

      <div className="edit-form-danger">
        {!confirmingDelete ? (
          <button type="button" className="edit-form-delete" onClick={() => setConfirmingDelete(true)}>
            Supprimer cette personne
          </button>
        ) : (
          <div className="edit-form-actions">
            <span className="data-panel-warning">
              Retire {person.firstName} de l’arbre, et des fiches des proches qui la citaient.
            </span>
            <button type="button" className="action-button data-panel-danger" onClick={onDelete}>
              Confirmer la suppression
            </button>
            <button type="button" className="action-button" onClick={() => setConfirmingDelete(false)}>
              Annuler
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
