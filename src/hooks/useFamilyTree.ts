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
 * Prépare tout ce qui ne dépend que des données : graphe, placement, index
 * spatial et index de recherche. Ce travail est fait une seule fois, jamais
 * pendant une interaction.
 */
export function useFamilyTree(dataset: FamilyDataset): FamilyTree {
  return useMemo(() => {
    const graph = buildFamilyGraph(dataset);
    const layout = computeLayout(graph);
    // La relecture se fait ici, une fois, au même titre que le placement : une
    // saisie fautive doit se voir au chargement, pas se découvrir six mois plus
    // tard en regardant l'arbre de travers.
    const anomalies = auditFamily(graph);
    reportAnomalies(anomalies);
    return {
      graph,
      layout,
      spatial: new SpatialIndex(layout),
      searchIndex: buildSearchIndex(graph),
      anomalies,
    };
  }, [dataset]);
}
