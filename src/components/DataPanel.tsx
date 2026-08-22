import { useRef, useState } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { FamilyDataset } from '@/data/schema';
import { parseGedcom } from '@/data/gedcom-import';
import { exportGedcom } from '@/data/gedcom-export';
import { CloseIcon } from './icons';

export interface DataPanelProps {
  graph: FamilyGraph;
  dataset: FamilyDataset;
  source: 'demo' | 'import' | 'edition';
  onImport: (dataset: FamilyDataset) => void;
  onReset: () => void;
  onClose: () => void;
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const STATUS_LABEL: Record<DataPanelProps['source'], string> = {
  demo: 'Arbre de démonstration',
  import: 'Arbre importé',
  edition: 'Arbre modifié dans le navigateur',
};

/**
 * Import, export, remise à zéro : le seul endroit où l'on parle du jeu de
 * données lui-même plutôt que d'une personne. Regroupé à part parce que ces
 * gestes sont rares et pour certains irréversibles (importer remplace tout
 * l'arbre affiché) — ils ne doivent pas se confondre avec la navigation
 * courante.
 */
export function DataPanel({ graph, dataset, source, onImport, onReset, onClose }: DataPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<{ dataset: FamilyDataset; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const handleFile = async (file: File): Promise<void> => {
    setError(null);
    setPending(null);
    try {
      const text = await file.text();
      const { dataset: parsed, warnings } = parseGedcom(text);
      if (parsed.people.length === 0) {
        setError('Aucune personne trouvée dans ce fichier — vérifiez qu’il s’agit bien d’un export GEDCOM.');
        return;
      }
      setPending({ dataset: parsed, warnings });
    } catch {
      setError('Ce fichier n’a pas pu être lu comme un GEDCOM valide.');
    }
  };

  return (
    <div className="modal-veil" onClick={onClose}>
      <div
        className="data-panel lg lg--thick"
        role="dialog"
        aria-label="Vos données"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="data-panel-head">
          <h2>Vos données</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer">
            <CloseIcon />
          </button>
        </div>

        <p className="data-panel-status">
          {STATUS_LABEL[source]} — {graph.people.size} personne{graph.people.size > 1 ? 's' : ''}
        </p>

        <section className="data-panel-section">
          <h3>Importer</h3>
          <p className="data-panel-hint">
            Un fichier GEDCOM (.ged) exporté depuis Geneanet, Ancestry, FamilySearch, Heredis… pour
            remplacer cet arbre par le vôtre.
          </p>

          {!pending && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ged,.gedcom,text/plain"
                className="data-panel-file-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = '';
                }}
              />
              <button type="button" className="action-button" onClick={() => fileInputRef.current?.click()}>
                Choisir un fichier GEDCOM
              </button>
              {error && <p className="data-panel-error">{error}</p>}
            </>
          )}

          {pending && (
            <div className="data-panel-preview">
              <p>
                <strong>{pending.dataset.people.length}</strong> personne
                {pending.dataset.people.length > 1 ? 's' : ''} trouvée
                {pending.dataset.people.length > 1 ? 's' : ''}.
              </p>
              {source !== 'demo' && (
                <p className="data-panel-warning">
                  Ceci remplacera l’arbre actuellement affiché ({graph.people.size} personnes). Exportez-le
                  d’abord si vous voulez le garder.
                </p>
              )}
              {pending.warnings.length > 0 && (
                <ul className="data-panel-warnings">
                  {pending.warnings.slice(0, 6).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                  {pending.warnings.length > 6 && <li>… et {pending.warnings.length - 6} autre(s).</li>}
                </ul>
              )}
              <div className="data-panel-actions">
                <button
                  type="button"
                  className="action-button data-panel-confirm"
                  onClick={() => {
                    onImport(pending.dataset);
                    setPending(null);
                    onClose();
                  }}
                >
                  Importer ces {pending.dataset.people.length} personnes
                </button>
                <button type="button" className="action-button" onClick={() => setPending(null)}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="data-panel-section">
          <h3>Exporter</h3>
          <p className="data-panel-hint">
            L’arbre affiché ne vit que dans ce navigateur : exportez-le régulièrement, un « vider le cache »
            l’effacerait sans laisser de trace.
          </p>
          <div className="data-panel-actions">
            <button
              type="button"
              className="action-button"
              onClick={() => download(`${dataset.title || 'arbre'}.ged`, exportGedcom(graph), 'text/plain')}
            >
              Télécharger en GEDCOM
            </button>
            <button
              type="button"
              className="action-button"
              onClick={() =>
                download(`${dataset.title || 'arbre'}.json`, JSON.stringify(dataset, null, 2), 'application/json')
              }
            >
              Télécharger en JSON
            </button>
          </div>
        </section>

        {source !== 'demo' && (
          <section className="data-panel-section">
            <h3>Réinitialiser</h3>
            {!confirmingReset ? (
              <button type="button" className="action-button" onClick={() => setConfirmingReset(true)}>
                Revenir à l’arbre de démonstration
              </button>
            ) : (
              <div className="data-panel-actions">
                <p className="data-panel-warning">
                  L’arbre actuel sera effacé du navigateur. Exportez-le d’abord si besoin.
                </p>
                <button
                  type="button"
                  className="action-button data-panel-danger"
                  onClick={() => {
                    onReset();
                    onClose();
                  }}
                >
                  Confirmer et effacer
                </button>
                <button type="button" className="action-button" onClick={() => setConfirmingReset(false)}>
                  Annuler
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
