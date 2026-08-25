import { useCallback, useEffect, useMemo, useState } from 'react';
import { FAMILY_DATASET } from '@/data';
import type { FamilyDataset, PersonRecord } from '@/data/schema';
import { fetchStoredFamily, saveStoredFamily, clearStoredFamily, type StoredFamily } from '@/data/storage';

export interface DatasetController {
  dataset: FamilyDataset;
  /** D'où vient l'arbre affiché : la démonstration, un import, ou des retouches. */
  source: 'demo' | StoredFamily['source'];
  /**
   * Vrai tant que la version partagée (voir `/api/family`) n'a pas encore
   * répondu. Le rideau d'ouverture (`App`) attend ce signal avant de
   * révéler l'arbre — sans quoi on verrait d'abord l'arbre local, puis un
   * saut brusque vers la version partagée dès qu'elle arrive.
   */
  loading: boolean;
  /**
   * Incrémenté seulement par `replace`/`reset`, jamais par `mutate` : le
   * signal que l'arbre affiché a changé de forme au point de mériter un
   * recadrage de la vue, par opposition à la simple retouche d'une fiche
   * qui ne doit surtout pas faire sauter la caméra à chaque champ modifié.
   */
  replaceVersion: number;
  /** Remplace tout l'arbre — après un import GEDCOM, par exemple. */
  replace: (dataset: FamilyDataset, source: StoredFamily['source']) => void;
  /** Modifie la liste des personnes tout en gardant titre et repère — le cas
   *  courant d'une retouche depuis la fiche de quelqu'un. */
  mutate: (mutator: (people: PersonRecord[]) => PersonRecord[]) => void;
  /** Revient à l'arbre de démonstration et efface la sauvegarde partagée. */
  reset: () => void;
}

/**
 * L'arbre affiché n'est plus une constante : import GEDCOM et retouches en
 * ont fait un état, gardé sur le serveur (voir `data/storage.ts`) pour être
 * le même quel que soit l'appareil qui ouvre le site. Un seul endroit décide
 * donc quel jeu de données est affiché — tout le reste de l'application
 * continue de ne connaître que `dataset`, comme avant quand il s'agissait
 * d'un import statique.
 *
 * Au montage, l'arbre local (`FAMILY_DATASET`) s'affiche tout de suite —
 * rien à attendre pour commencer à dessiner — puis la version partagée le
 * remplace dès qu'elle répond. Si le serveur ne répond jamais (hors ligne,
 * espace KV pas encore relié), on continue simplement avec l'arbre local.
 */
export function useDataset(): DatasetController {
  const [state, setState] = useState<{ dataset: FamilyDataset; source: DatasetController['source'] }>({
    dataset: FAMILY_DATASET,
    source: 'demo',
  });
  const [loading, setLoading] = useState(true);
  const [replaceVersion, setReplaceVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchStoredFamily()
      .then((stored) => {
        if (cancelled || !stored) return;
        setState({ dataset: stored.dataset, source: stored.source });
        setReplaceVersion((v) => v + 1);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const replace = useCallback((dataset: FamilyDataset, source: StoredFamily['source']) => {
    setState({ dataset, source });
    setReplaceVersion((v) => v + 1);
    void saveStoredFamily(dataset, source).catch((error: unknown) => {
      console.error('Échec de la sauvegarde partagée :', error);
    });
  }, []);

  const mutate = useCallback((mutator: (people: PersonRecord[]) => PersonRecord[]) => {
    setState((current) => {
      const dataset: FamilyDataset = { ...current.dataset, people: mutator(current.dataset.people) };
      void saveStoredFamily(dataset, 'edition').catch((error: unknown) => {
        console.error('Échec de la sauvegarde partagée :', error);
      });
      return { dataset, source: 'edition' };
    });
  }, []);

  const reset = useCallback(() => {
    setState({ dataset: FAMILY_DATASET, source: 'demo' });
    setReplaceVersion((v) => v + 1);
    void clearStoredFamily();
  }, []);

  return useMemo(
    () => ({ ...state, loading, replaceVersion, replace, mutate, reset }),
    [state, loading, replaceVersion, replace, mutate, reset],
  );
}
