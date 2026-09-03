import { useState, type FormEvent, type ReactNode } from 'react';
import type { Milestone, Person, PersonRecord } from '@/data/schema';
import { toPersonRecord } from '@/domain/edit';

export interface PersonEditFormProps {
  person: Person;
  onSave: (record: PersonRecord) => void;
  onCancel: () => void;
  onDelete: () => void;
  /**
   * L'éditeur de liens (parents, unions, enfants), rendu par la fiche et
   * inséré ici.
   *
   * Il est passé plutôt que construit sur place parce qu'il ne suit pas la
   * même règle que le reste du formulaire : les champs se valident en bloc à
   * l'enregistrement, un lien s'applique à l'instant où on le pose. Le
   * mélanger à `values` reviendrait à pouvoir « annuler » une filiation déjà
   * inscrite dans l'arbre.
   */
  relationEditor?: ReactNode;
}

interface Field {
  key: keyof PersonRecord;
  label: string;
  placeholder?: string;
  type?: 'text' | 'textarea';
}

const FIELDS: Field[] = [
  { key: 'nickname', label: 'Surnom' },
  { key: 'maidenName', label: 'Nom de naissance', placeholder: 'quand il diffère du nom porté' },
  { key: 'middleNames', label: 'Second(s) prénom(s)' },
  { key: 'headline', label: 'Phrase courte (sur la carte)', placeholder: '2 à 4 mots' },
  { key: 'photo', label: 'Photo', placeholder: 'URL d’une image' },
  { key: 'birthDate', label: 'Naissance', placeholder: '1887, 1887-04-23, vers 1887…' },
  { key: 'birthPlace', label: 'Lieu de naissance' },
  { key: 'deathDate', label: 'Décès' },
  { key: 'deathPlace', label: 'Lieu de décès' },
  { key: 'profession', label: 'Profession' },
  { key: 'education', label: 'Études' },
];

/** Un brouillon de jalon garde tout en texte, y compris l'année : on ne
 *  force pas un format tant que le formulaire n'a pas été soumis. */
interface MilestoneDraft {
  year: string;
  title: string;
  detail: string;
}

/** Ne garde que les entrées non vides, sans espaces superflus ; `undefined`
 *  si la liste est vide — un tableau vide et un champ absent doivent se
 *  comporter pareil partout ailleurs dans l'application. */
function cleanList(items: string[]): string[] | undefined {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Passions, centres d'intérêt : de petites étiquettes qu'on ajoute une par
 *  une, comme des mots-clés plutôt que des phrases. */
function TagListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (): void => {
    const value = draft.trim();
    if (!value || items.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...items, value]);
    setDraft('');
  };

  return (
    <div className="edit-field edit-list-field">
      <span>{label}</span>
      {items.length > 0 && (
        <ul className="edit-chip-list">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="edit-chip">
              {item}
              <button
                type="button"
                className="edit-chip-remove"
                aria-label={`Retirer « ${item} »`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="edit-list-add-row">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="edit-list-add" onClick={add} disabled={!draft.trim()}>
          Ajouter
        </button>
      </div>
    </div>
  );
}

/** Anecdotes, souvenirs : des paragraphes libres, un par entrée. */
function TextListEditor({
  label,
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel: string;
}) {
  const update = (index: number, value: string): void => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };
  const remove = (index: number): void => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="edit-field edit-list-field">
      <span>{label}</span>
      {items.map((item, index) => (
        <div key={index} className="edit-list-row">
          <textarea
            rows={2}
            value={item}
            placeholder={placeholder}
            onChange={(event) => update(index, event.target.value)}
          />
          <button
            type="button"
            className="edit-list-remove"
            aria-label="Retirer cette entrée"
            onClick={() => remove(index)}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="edit-list-add" onClick={() => onChange([...items, ''])}>
        {addLabel}
      </button>
    </div>
  );
}

/** Événements marquants : année, titre, détail facultatif — la même forme
 *  que la frise déjà affichée dans la fiche, en éditable. */
function MilestoneListEditor({
  items,
  onChange,
}: {
  items: MilestoneDraft[];
  onChange: (items: MilestoneDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<MilestoneDraft>): void => {
    const next = [...items];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const remove = (index: number): void => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="edit-field edit-list-field">
      <span>Événements marquants</span>
      {items.map((item, index) => (
        <div key={index} className="edit-milestone-row">
          <div className="edit-form-row">
            <input
              className="edit-milestone-year"
              value={item.year}
              placeholder="Année"
              onChange={(event) => update(index, { year: event.target.value })}
            />
            <input
              value={item.title}
              placeholder="Titre — ex. Décoré de la médaille militaire"
              onChange={(event) => update(index, { title: event.target.value })}
            />
            <button
              type="button"
              className="edit-list-remove"
              aria-label="Retirer cet événement"
              onClick={() => remove(index)}
            >
              ×
            </button>
          </div>
          <textarea
            rows={2}
            value={item.detail}
            placeholder="Détail (facultatif)"
            onChange={(event) => update(index, { detail: event.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="edit-list-add"
        onClick={() => onChange([...items, { year: '', title: '', detail: '' }])}
      >
        + Ajouter un événement
      </button>
    </div>
  );
}

/** Un lien externe garde libellé et adresse en texte : on ne valide l'URL
 *  qu'à l'affichage (voir `DetailPanel`), pas pendant la saisie. */
interface LinkDraft {
  label: string;
  url: string;
}

/** Sources et liens : un libellé et une adresse par entrée. */
function LinkListEditor({
  items,
  onChange,
}: {
  items: LinkDraft[];
  onChange: (items: LinkDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<LinkDraft>): void => {
    const next = [...items];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const remove = (index: number): void => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="edit-field edit-list-field">
      <span>Sources et liens</span>
      {items.map((item, index) => (
        <div key={index} className="edit-form-row edit-form-row--fields">
          <input
            value={item.label}
            placeholder="Libellé — ex. Acte de naissance"
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <input
            value={item.url}
            type="url"
            placeholder="https://…"
            onChange={(event) => update(index, { url: event.target.value })}
          />
          <button
            type="button"
            className="edit-list-remove"
            aria-label="Retirer ce lien"
            onClick={() => remove(index)}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="edit-list-add"
        onClick={() => onChange([...items, { label: '', url: '' }])}
      >
        + Ajouter un lien
      </button>
    </div>
  );
}

/** Une entrée de `custom` : une clé libre (« Service militaire »…) et sa
 *  valeur. Les valeurs multiples (`string[]`) s'éditent jointes par « · »,
 *  comme elles s'affichent déjà dans la fiche (voir `FactRow`), et se
 *  redécoupent à l'enregistrement. */
interface CustomFieldDraft {
  key: string;
  value: string;
}

/** Champs libres : tout ce que le schéma n'a pas prévu, en clé/valeur. */
function CustomFieldsEditor({
  items,
  onChange,
}: {
  items: CustomFieldDraft[];
  onChange: (items: CustomFieldDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<CustomFieldDraft>): void => {
    const next = [...items];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const remove = (index: number): void => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="edit-field edit-list-field">
      <span>Informations complémentaires</span>
      {items.map((item, index) => (
        <div key={index} className="edit-form-row edit-form-row--fields">
          <input
            value={item.key}
            placeholder="Champ — ex. Service militaire"
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <input
            value={item.value}
            placeholder="Valeur — plusieurs valeurs séparées par « · »"
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <button
            type="button"
            className="edit-list-remove"
            aria-label="Retirer ce champ"
            onClick={() => remove(index)}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="edit-list-add" onClick={() => onChange([...items, { key: '', value: '' }])}>
        + Ajouter un champ
      </button>
    </div>
  );
}

/**
 * Le formulaire couvre désormais tout le schéma d'une personne — seul le
 * parcours de vie affiché dans la fiche n'a volontairement pas d'équivalent
 * ici : il est reconstruit à partir des dates, des unions et des naissances
 * d'enfants déjà saisies (voir `domain/timeline.ts`), pas ressaisi à part.
 */
export function PersonEditForm({
  person,
  onSave,
  onCancel,
  onDelete,
  relationEditor,
}: PersonEditFormProps) {
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
  const [interests, setInterests] = useState<string[]>(person.interests ?? []);
  const [anecdotes, setAnecdotes] = useState<string[]>(person.anecdotes ?? []);
  const [memories, setMemories] = useState<string[]>(person.memories ?? []);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>(
    (person.milestones ?? []).map((milestone) => ({
      year: milestone.year ?? '',
      title: milestone.title,
      detail: milestone.detail ?? '',
    })),
  );
  const [residences, setResidences] = useState<string[]>(person.residences ?? []);
  const [links, setLinks] = useState<LinkDraft[]>(
    (person.links ?? []).map((link) => ({ label: link.label, url: link.url })),
  );
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>(
    Object.entries(person.custom ?? {}).map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? value.join(' · ') : value,
    })),
  );

  const set = (key: string, value: string): void => setValues((v) => ({ ...v, [key]: value }));

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    // `person` est la fiche enrichie : n'en garder que ce qui a été saisi,
    // sans les déductions du graphe — voir `toPersonRecord`.
    const record: PersonRecord = {
      ...toPersonRecord(person),
      firstName: values.firstName.trim() || person.firstName,
      lastName: values.lastName.trim(),
      gender: gender ? (gender as PersonRecord['gender']) : undefined,
      biography: values.biography.trim() || undefined,
      notes: values.notes.trim() || undefined,
      interests: cleanList(interests),
      anecdotes: cleanList(anecdotes),
      memories: cleanList(memories),
      milestones: (() => {
        const cleaned: Milestone[] = milestones
          .map((milestone) => ({
            year: milestone.year.trim() || undefined,
            title: milestone.title.trim(),
            detail: milestone.detail.trim() || undefined,
          }))
          .filter((milestone) => milestone.title.length > 0);
        return cleaned.length > 0 ? cleaned : undefined;
      })(),
      residences: cleanList(residences),
      links: (() => {
        const cleaned = links
          .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
          .filter((link) => link.label.length > 0 && link.url.length > 0);
        return cleaned.length > 0 ? cleaned : undefined;
      })(),
      custom: (() => {
        const entries = customFields
          .map(({ key, value }) => [key.trim(), value.trim()] as const)
          .filter(([key, value]) => key.length > 0 && value.length > 0)
          .map(([key, value]) => [key, value.includes(' · ') ? value.split(' · ') : value] as const);
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
      })(),
    };
    for (const field of FIELDS) {
      const value = values[field.key]?.trim();
      (record as unknown as Record<string, unknown>)[field.key] = value || undefined;
    }
    onSave(record);
  };

  return (
    <div className="edit-pane">
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

      <TagListEditor
        label="Lieux de vie"
        items={residences}
        onChange={setResidences}
        placeholder="Une ville, un quartier…"
      />

      <label className="edit-field">
        <span>Biographie</span>
        <textarea rows={4} value={values.biography} onChange={(e) => set('biography', e.target.value)} />
      </label>

      <TagListEditor
        label="Ce qu’elle ou il aimait"
        items={interests}
        onChange={setInterests}
        placeholder="Une passion, un loisir…"
      />

      <MilestoneListEditor items={milestones} onChange={setMilestones} />

      <TextListEditor
        label="Anecdotes"
        items={anecdotes}
        onChange={setAnecdotes}
        placeholder="Une anecdote…"
        addLabel="+ Ajouter une anecdote"
      />

      <TextListEditor
        label="Souvenirs de famille"
        items={memories}
        onChange={setMemories}
        placeholder="Un souvenir raconté par la famille…"
        addLabel="+ Ajouter un souvenir"
      />

      <label className="edit-field">
        <span>Notes</span>
        <textarea rows={3} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>

      <CustomFieldsEditor items={customFields} onChange={setCustomFields} />

      <LinkListEditor items={links} onChange={setLinks} />

      <div className="edit-form-actions">
        <button type="submit" className="action-button action-button--confirm">
          Enregistrer
        </button>
        <button type="button" className="action-button" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>

    {/*
      * Hors du <form> ci-dessus, délibérément.
      *
      * L'éditeur de liens contient lui-même un formulaire (`AddRelativeForm`)
      * et le HTML interdit d'imbriquer deux <form> : le navigateur rattache
      * alors le bouton intérieur au formulaire extérieur. Placé dedans,
      * « Ajouter » enregistrait la fiche et refermait le panneau au lieu
      * d'ajouter le proche.
      */}
    {relationEditor && (
      <div className="edit-form-relations">
        <p className="edit-form-relations-note">
          Les liens s’appliquent immédiatement, sans passer par « Enregistrer ».
        </p>
        {relationEditor}
      </div>
    )}

      <div className="edit-form-danger">
        {!confirmingDelete ? (
          <button type="button" className="edit-form-delete" onClick={() => setConfirmingDelete(true)}>
            Supprimer cette personne
          </button>
        ) : (
          <div className="edit-form-actions">
            <span className="form-warning">
              Retire {person.firstName} de l’arbre, et des fiches des proches qui la citaient.
            </span>
            <button type="button" className="action-button action-button--danger" onClick={onDelete}>
              Confirmer la suppression
            </button>
            <button type="button" className="action-button" onClick={() => setConfirmingDelete(false)}>
              Annuler
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
