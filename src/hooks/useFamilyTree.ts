import { useMemo } from 'react';
import type { FamilyDataset } from '@/data/schema';
import { buildFamilyGraph, type FamilyGraph } from '@/domain/graph';
import { computeLayout, type TreeLayout } from '@/domain/layout';
import { buildSearchIndex, type SearchIndex } from '@/domain/search';
import { SpatialIndex } from '@/view/spatial';

export interface FamilyTree {
  graph: FamilyGraph;
  layout: TreeLayout;
  spatial: SpatialIndex;
  searchIndex: SearchIndex;
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
    return {
      graph,
      layout,
      spatial: new SpatialIndex(layout),
      searchIndex: buildSearchIndex(graph),
    };
  }, [dataset]);
}
