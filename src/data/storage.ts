import type { FamilyDataset } from './schema';

/**
 * La famille de l'utilisateur, partagée entre tous les appareils.
 *
 * Un arbre importé ou modifié dans l'application passe par `/api/family`,
 * servi par le Worker (voir `worker/index.ts`) et gardé dans Cloudflare KV —
 * la seule mémoire commune à tout le monde qui ouvre le site, protégée par
 * Cloudflare Access au même titre que le reste. Avant cette API, chaque
 * navigateur gardait sa propre copie (`localStorage`) : un proche ouvrant le
 * site depuis son téléphone ne voyait jamais ce qui avait été saisi
 * ailleurs.
 *
 * Il n'existe plus de bouton pour sortir une copie de l'arbre : l'import et
 * l'export GEDCOM ont été retirés de l'interface. Ce qu'il y a dans KV est
 * donc la seule copie — une sauvegarde passe aujourd'hui par le tableau de
 * bord Cloudflare.
 */

export interface StoredFamily {
  dataset: FamilyDataset;
  /** D'où vient ce jeu de données, pour l'afficher dans les réglages. */
  source: 'import' | 'edition';
  savedAt: string;
}

/** `null` si rien n'a encore été enregistré, ou si l'API est injoignable —
 *  l'appelant retombe alors sur l'arbre local (voir `useDataset`). */
export async function fetchStoredFamily(): Promise<StoredFamily | null> {
  try {
    const response = await fetch('/api/family');
    if (!response.ok) return null;
    const parsed = (await response.json()) as StoredFamily | null;
    if (!parsed?.dataset?.people || !Array.isArray(parsed.dataset.people)) return null;
    return parsed;
  } catch {
    // Hors ligne, ou le Worker n'est pas encore relié à un espace KV.
    return null;
  }
}

export async function saveStoredFamily(dataset: FamilyDataset, source: StoredFamily['source']): Promise<void> {
  const entry: StoredFamily = { dataset, source, savedAt: new Date().toISOString() };
  let response: Response;
  try {
    response = await fetch('/api/family', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch {
    throw new Error('Impossible de joindre le serveur — vérifiez votre connexion.');
  }
  if (!response.ok) {
    throw new Error("Le serveur a refusé d'enregistrer cette modification.");
  }
}
