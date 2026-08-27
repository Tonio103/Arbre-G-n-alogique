import { useMemo } from 'react';
import type { FamilyDataset } from '@/data/schema';
import { auditFamily, reportAnomalies, type Anomaly } from '@/domain/check';
import { buildFamilyGraph, type FamilyGraph } from '@/domain/graph';
import { computeLayout, type TreeLayout } from '@/domain/layout';
import { buildSearchIndex, type SearchIndex } from '@/domain/search';
import { SpatialIndex } from '@/view/spatial';

export interface FamilyTree {
  graph: FamilyGraph;
  layout: TreeLayout;
  spatial: SpatialIndex;
  searchIndex: SearchIndex;
  /** Ce que la relecture des données a trouvé d'invraisemblable. */
  anomalies: Anomaly[];
}

/**
 * Prépare graphe, placement, index spatial et index de recherche.
 *
 * Deux mémos, pas un seul, parce que ces travaux ne dépendent pas des mêmes
 * choses :
 *
 *   · le GRAPHE, la RECHERCHE et la RELECTURE ne dépendent que des données.
 *     Changer de personne regardée ne change pas qui est le père de qui, ni
 *     l'orthographe d'un nom, ni les anomalies à signaler.
 *   · le PLACEMENT et l'index SPATIAL, eux, dépendent de la personne
 *     regardée : c'est autour d'elle que l'arbre se dessine.
 *
 * Tout mettre dans le même mémo refaisait les cinq à chaque clic. À quatre-
 * vingts personnes cela ne se sentait pas ; à cinq cents, chaque changement de
 * branche aurait reconstruit l'intégralité du graphe et réindexé toute la
 * recherche pour redessiner quarante cartes.
 */
export function useFamilyTree(
  dataset: FamilyDataset,
  focusId?: string,
  familyOnly = false,
): FamilyTree {
  const { graph, searchIndex, anomalies } = useMemo(() => {
    const built = buildFamilyGraph(dataset);
    // La relecture se fait ici, une fois, au même titre que la construction :
    // une saisie fautive doit se voir au chargement, pas se découvrir six mois
    // plus tard en regardant l'arbre de travers.
    const found = auditFamily(built);
    reportAnomalies(found);
    return { graph: built, searchIndex: buildSearchIndex(built), anomalies: found };
  }, [dataset]);

  const { layout, spatial } = useMemo(() => {
    const placed = computeLayout(graph, focusId, { familyOnly });
    return { layout: placed, spatial: new SpatialIndex(placed) };
  }, [graph, focusId, familyOnly]);

  return { graph, layout, spatial, searchIndex, anomalies };
}
