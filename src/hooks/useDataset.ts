import { useCallback, useMemo, useState } from 'react';
import { FAMILY_DATASET } from '@/data';
import type { FamilyDataset, PersonRecord } from '@/data/schema';
import { loadStoredFamily, saveStoredFamily, clearStoredFamily, type StoredFamily } from '@/data/storage';

export interface DatasetController {
  dataset: FamilyDataset;
  /** D'où vient l'arbre affiché : la démonstration, un import, ou des retouches. */
  source: 'demo' | StoredFamily['source'];
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
  /** Revient à l'arbre de démonstration et efface la sauvegarde locale. */
  reset: () => void;
}

/**
 * L'arbre affiché n'est plus une constante : import GEDCOM et retouches en
 * ont fait un état, gardé dans le navigateur faute de serveur où l'écrire.
 * Un seul endroit décide donc quel jeu de données est affiché — tout le
 * reste de l'application continue de ne connaître que `dataset`, comme
 * avant quand il s'agissait d'un import statique.
 */
export function useDataset(): DatasetController {
  const [state, setState] = useState<{ dataset: FamilyDataset; source: DatasetController['source'] }>(() => {
    const stored = loadStoredFamily();
    if (stored) return { dataset: stored.dataset, source: stored.source };
    return { dataset: FAMILY_DATASET, source: 'demo' };
  });
  const [replaceVersion, setReplaceVersion] = useState(0);

  const replace = useCallback((dataset: FamilyDataset, source: StoredFamily['source']) => {
    saveStoredFamily(dataset, source);
    setState({ dataset, source });
    setReplaceVersion((v) => v + 1);
  }, []);

  const mutate = useCallback((mutator: (people: PersonRecord[]) => PersonRecord[]) => {
    setState((current) => {
      const dataset: FamilyDataset = { ...current.dataset, people: mutator(current.dataset.people) };
      saveStoredFamily(dataset, 'edition');
      return { dataset, source: 'edition' };
    });
  }, []);

  const reset = useCallback(() => {
    clearStoredFamily();
    setState({ dataset: FAMILY_DATASET, source: 'demo' });
    setReplaceVersion((v) => v + 1);
  }, []);

  return useMemo(
    () => ({ ...state, replaceVersion, replace, mutate, reset }),
    [state, replaceVersion, replace, mutate, reset],
  );
}
