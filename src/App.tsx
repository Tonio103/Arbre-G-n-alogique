import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FAMILY_DATASET } from '@/data';
import { useFamilyTree } from '@/hooks/useFamilyTree';
import { useTheme } from '@/hooks/useTheme';
import { useIsCompact } from '@/hooks/useMediaQuery';
import { computeHighlight, type HighlightMode } from '@/domain/relations';
import { ViewportController, transformForBounds } from '@/view/viewport';
import { HoverStore } from '@/view/hover-store';
import { CARD_HEIGHT, CARD_WIDTH, FIT_PADDING } from '@/view/metrics';
import { Backdrop } from '@/components/Backdrop';
import { BranchLabels } from '@/components/BranchLabels';
import { TopBar } from '@/components/TopBar';
import { TreeCanvas } from '@/components/TreeCanvas';
import { DetailPanel } from '@/components/DetailPanel';
import { MiniMap } from '@/components/MiniMap';
import { GenerationRail } from '@/components/GenerationRail';

import '@/styles/base.css';
import '@/styles/app.css';
import '@/styles/avatar.css';
import '@/styles/node.css';
import '@/styles/chrome.css';
import '@/styles/detail.css';

/** Largeur réservée au panneau de détails lors d'un recentrage, sur grand écran. */
const PANEL_OFFSET = 400;

export default function App() {
  const { graph, layout, spatial, searchIndex } = useFamilyTree(FAMILY_DATASET);
  const [theme, toggleTheme] = useTheme();
  const compact = useIsCompact();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('close');
  const [flaggedId, setFlaggedId] = useState<string | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [hintVisible, setHintVisible] = useState(true);

  const hoverStore = useMemo(() => new HoverStore(), []);
  const viewport = useMemo(
    () => new ViewportController({ bounds: layout.bounds }),
    [layout.bounds],
  );

  useEffect(() => () => viewport.destroy(), [viewport]);

  const panelOffset = compact ? 0 : PANEL_OFFSET;

  const focusOn = useCallback(
    (id: string, options?: { scale?: number; duration?: number; withPanel?: boolean }) => {
      const position = layout.positions.get(id);
      if (!position) return;
      viewport.focusPoint(
        position.x + CARD_WIDTH / 2,
        position.y + CARD_HEIGHT / 2,
        options?.scale ?? Math.max(viewport.transform.scale, 0.92),
        options?.withPanel === false ? 0 : panelOffset,
        options?.duration ?? 720,
      );
    },
    [layout, viewport, panelOffset],
  );

  const selectPerson = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setHintVisible(false);
      if (id) focusOn(id);
      else setFlaggedId(null);
    },
    [focusOn],
  );

  const pickFromSearch = useCallback(
    (id: string) => {
      setSelectedId(id);
      setFlaggedId(id);
      setHintVisible(false);
      focusOn(id, { scale: Math.max(viewport.transform.scale, 1), duration: 900 });
    },
    [focusOn, viewport],
  );

  const goHome = useCallback(() => {
    setSelectedId(graph.rootId);
    setFlaggedId(graph.rootId);
    focusOn(graph.rootId, { scale: 1.05, duration: 820 });
  }, [graph.rootId, focusOn]);

  const fitAll = useCallback(() => {
    setFlaggedId(null);
    viewport.fit(layout.bounds, FIT_PADDING, 0.9, 820);
  }, [viewport, layout.bounds]);

  // Ouverture : l'arbre entier apparaît d'abord, puis la vue plonge vers la
  // personne principale. En une seconde, on comprend l'échelle et où l'on est.
  const introRef = useRef(false);
  useEffect(() => {
    if (introRef.current) return;
    const stageSize = viewport.size;
    if (stageSize.width <= 1) return;
    introRef.current = true;

    viewport.set(transformForBounds(layout.bounds, stageSize, FIT_PADDING, 0.85));
    const timer = window.setTimeout(() => {
      const position = layout.positions.get(graph.rootId);
      if (!position) return;
      viewport.focusPoint(
        position.x + CARD_WIDTH / 2,
        position.y + CARD_HEIGHT / 2,
        1.05,
        0,
        1500,
      );
    }, 620);
    return () => window.clearTimeout(timer);
  }, [viewport, layout, graph.rootId, selectedId]);

  // Raccourcis clavier généraux, inactifs pendant la saisie d'une recherche.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case '0':
          event.preventDefault();
          fitAll();
          break;
        case 'h':
        case 'H':
          event.preventDefault();
          goHome();
          break;
        case 'l':
        case 'L':
          event.preventDefault();
          setHighlightMode((mode) => (mode === 'close' ? 'lineage' : 'close'));
          break;
        case 'Escape':
          if (selectedId) setSelectedId(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fitAll, goHome, selectedId]);

  // La pastille de recherche s'estompe d'elle-même.
  useEffect(() => {
    if (!flaggedId) return undefined;
    const timer = window.setTimeout(() => setFlaggedId(null), 6000);
    return () => window.clearTimeout(timer);
  }, [flaggedId]);

  const highlight = useMemo(
    () => computeHighlight(graph, selectedId, highlightMode),
    [graph, selectedId, highlightMode],
  );

  const highlightPeople = useMemo(() => new Set(highlight.people.keys()), [highlight]);

  const selectedPerson = selectedId ? (graph.people.get(selectedId) ?? null) : null;

  return (
    <div className="app" data-panel-open={selectedPerson ? true : undefined}>
      <Backdrop viewport={viewport} />

      <TreeCanvas
        graph={graph}
        layout={layout}
        spatial={spatial}
        viewport={viewport}
        hoverStore={hoverStore}
        highlight={highlight}
        selectedId={selectedId}
        flaggedId={flaggedId}
        onSelect={selectPerson}
        theme={theme}
      />

      <TopBar
        graph={graph}
        searchIndex={searchIndex}
        onPick={pickFromSearch}
        onHome={goHome}
        onFit={fitAll}
        onZoomIn={() => viewport.zoomBy(1.35)}
        onZoomOut={() => viewport.zoomBy(1 / 1.35)}
        highlightMode={highlightMode}
        onToggleHighlightMode={() =>
          setHighlightMode((mode) => (mode === 'close' ? 'lineage' : 'close'))
        }
        theme={theme}
        onToggleTheme={toggleTheme}
        showMiniMap={showMiniMap}
        onToggleMiniMap={() => setShowMiniMap((value) => !value)}
      />

      <BranchLabels
        regions={layout.regions}
        viewport={viewport}
        onFocusRegion={(region) => {
          // Cadrer la branche entière : on passe de la vue d'ensemble au détail
          // d'une lignée en un geste.
          viewport.fit(
            {
              minX: region.minX,
              maxX: region.maxX,
              minY: region.y,
              maxY: layout.bounds.maxY,
            },
            80,
            0.75,
            760,
          );
        }}
      />

      <GenerationRail rows={layout.rows} positions={layout.positions} viewport={viewport} />

      {showMiniMap && !compact && (
        <MiniMap layout={layout} viewport={viewport} highlighted={highlightPeople} theme={theme} />
      )}

      <DetailPanel
        graph={graph}
        person={selectedPerson}
        onSelect={selectPerson}
        onClose={() => setSelectedId(null)}
        onCenter={() => selectedId && focusOn(selectedId, { scale: 1.15, duration: 640 })}
        onShowLineage={() =>
          setHighlightMode((mode) => (mode === 'close' ? 'lineage' : 'close'))
        }
        lineageActive={highlightMode === 'lineage'}
      />

      <div className="hint-bar glass" data-hidden={hintVisible ? undefined : true}>
        <span>
          <kbd>Molette</kbd> zoom
        </span>
        <span className="hint-sep" aria-hidden="true" />
        <span>
          <kbd>Glisser</kbd> déplacer
        </span>
        <span className="hint-sep" aria-hidden="true" />
        <span>
          <kbd>⌘</kbd> <kbd>K</kbd> rechercher
        </span>
        <span className="hint-sep" aria-hidden="true" />
        <span>
          <kbd>0</kbd> vue d’ensemble
        </span>
      </div>
    </div>
  );
}
