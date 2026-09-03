import { useCallback, useEffect, useMemo, useState } from 'react';
import { FAMILY_DATASET } from '@/data';
import type { FamilyDataset, PersonRecord } from '@/data/schema';
import { fetchStoredFamily, saveStoredFamily } from '@/data/storage';

export interface DatasetController {
  dataset: FamilyDataset;
  /**
   * Vrai tant que la version partagée (voir `/api/family`) n'a pas encore
   * répondu. Le rideau d'ouverture (`App`) attend ce signal avant de
   * révéler l'arbre — sans quoi on verrait d'abord l'arbre local, puis un
   * saut brusque vers la version partagée dès qu'elle arrive.
   */
  loading: boolean;
  /**
   * Incrémenté quand l'arbre change de FORME au point de mériter un
   * recadrage de la vue, par opposition à la simple retouche d'une fiche qui
   * ne doit surtout pas faire sauter la caméra à chaque champ modifié.
   *
   * Un seul cas le fait aujourd'hui : l'arrivée de la version partagée, qui
   * remplace l'arbre local par celui de la famille. `replace` et `reset` le
   * faisaient aussi, du temps où l'on pouvait importer un GEDCOM ou revenir
   * à la démonstration ; ces deux gestes ont quitté l'interface.
   */
  replaceVersion: number;
  /** Modifie la liste des personnes tout en gardant titre et repère — le cas
   *  courant d'une retouche depuis la fiche de quelqu'un. */
  mutate: (mutator: (people: PersonRecord[]) => PersonRecord[]) => void;
}

/**
 * L'arbre affiché n'est plus une constante : les retouches en ont fait un
 * état, gardé sur le serveur (voir `data/storage.ts`) pour être le même quel
 * que soit l'appareil qui ouvre le site. Un seul endroit décide donc quel jeu
 * de données est affiché — tout le reste de l'application continue de ne
 * connaître que `dataset`, comme avant quand il s'agissait d'une constante.
 *
 * Au montage, l'arbre local (`FAMILY_DATASET`) s'affiche tout de suite —
 * rien à attendre pour commencer à dessiner — puis la version partagée le
 * remplace dès qu'elle répond. Si le serveur ne répond jamais (hors ligne,
 * espace KV pas encore relié), on continue simplement avec l'arbre local.
 */
export function useDataset(): DatasetController {
  const [dataset, setDataset] = useState<FamilyDataset>(FAMILY_DATASET);
  const [loading, setLoading] = useState(true);
  const [replaceVersion, setReplaceVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchStoredFamily()
      .then((stored) => {
        if (cancelled || !stored) return;
        setDataset(stored.dataset);
        setReplaceVersion((v) => v + 1);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback((mutator: (people: PersonRecord[]) => PersonRecord[]) => {
    setDataset((current) => {
      const next: FamilyDataset = { ...current, people: mutator(current.people) };
      void saveStoredFamily(next, 'edition').catch((error: unknown) => {
        console.error('Échec de la sauvegarde partagée :', error);
      });
      return next;
    });
  }, []);

  return useMemo(
    () => ({ dataset, loading, replaceVersion, mutate }),
    [dataset, loading, replaceVersion, mutate],
  );
}
