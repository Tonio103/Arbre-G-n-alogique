import type { UnionStatus } from '@/data/schema';

export interface UnionValue {
  status: UnionStatus;
  since: string;
  place: string;
}

export interface UnionFieldsProps {
  value: UnionValue;
  onChange: (value: UnionValue) => void;
}

/**
 * Statut, date et lieu d'une union — les trois champs qui se saisissent à la
 * création d'un conjoint (`AddRelativeForm`) et qui se corrigent ensuite
 * (`RelationEditor`). Un seul endroit pour ce trio évite qu'une correction
 * faite dans l'un des deux formulaires oublie l'autre.
 */
export function UnionFields({ value, onChange }: UnionFieldsProps) {
  return (
    <>
      <div className="edit-form-row edit-form-row--split">
        <label className="edit-field">
          <span>Statut</span>
          <select
            value={value.status}
            onChange={(e) => onChange({ ...value, status: e.target.value as UnionStatus })}
          >
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
          <input
            value={value.since}
            onChange={(e) => onChange({ ...value, since: e.target.value })}
            placeholder="1925…"
          />
        </label>
      </div>
      <label className="edit-field">
        <span>Lieu d’union</span>
        <input
          value={value.place}
          onChange={(e) => onChange({ ...value, place: e.target.value })}
        />
      </label>
    </>
  );
}
