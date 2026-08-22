import type { FamilyDataset } from './schema';

/**
 * La famille de l'utilisateur, gardée dans le navigateur.
 *
 * Un arbre importé ou modifié dans l'application n'a nulle part où vivre :
 * il n'y a pas de serveur, et les fichiers `core-family.ts` / `ma-famille.ts`
 * sont compilés dans le bundle, pas réinscriptibles depuis l'interface. Le
 * stockage local du navigateur est donc la seule mémoire dont on dispose —
 * ce qui en fait aussi la seule sauvegarde : voir `gedcom-export.ts` et le
 * bouton d'export pour en sortir une copie qui survit à un « vider le cache ».
 */
const STORAGE_KEY = 'arbre-famille-v1';

export interface StoredFamily {
  dataset: FamilyDataset;
  /** D'où vient ce jeu de données, pour l'afficher dans les réglages. */
  source: 'import' | 'edition';
  savedAt: string;
}

export function loadStoredFamily(): StoredFamily | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFamily;
    if (!parsed?.dataset?.people || !Array.isArray(parsed.dataset.people)) return null;
    return parsed;
  } catch {
    // Une entrée corrompue ne doit pas empêcher l'application de démarrer :
    // elle retombe simplement sur la démonstration.
    return null;
  }
}

export function saveStoredFamily(dataset: FamilyDataset, source: StoredFamily['source']): void {
  if (typeof window === 'undefined') return;
  const entry: StoredFamily = { dataset, source, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch (error) {
    // Le quota du navigateur est dépassé, ou le stockage est désactivé
    // (navigation privée, par exemple) : l'appelant décide quoi en dire.
    throw new Error(
      error instanceof Error && error.name === 'QuotaExceededError'
        ? "L'arbre est trop volumineux pour la mémoire du navigateur."
        : "Le navigateur refuse d'enregistrer (stockage désactivé ?).",
    );
  }
}

export function clearStoredFamily(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
