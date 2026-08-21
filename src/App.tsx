import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FAMILY_DATASET } from '@/data';
import { useFamilyTree } from '@/hooks/useFamilyTree';
import { useTheme } from '@/hooks/useTheme';
import { useGlassLight } from '@/hooks/useGlassLight';
import { useIsCompact } from '@/hooks/useMediaQuery';
import { computeHighlight, type HighlightMode } from '@/domain/relations';
import { ViewportController, transformForBounds } from '@/view/viewport';
import { HoverStore } from '@/view/hover-store';
import { CARD_HEIGHT, CARD_WIDTH, FIT_PADDING, ROW_HEIGHT } from '@/view/metrics';
import { Backdrop } from '@/components/Backdrop';
import { GlassFilters } from '@/components/GlassFilters';
import { BranchLabels } from '@/components/BranchLabels';
import { TopBar } from '@/components/TopBar';
import { TreeCanvas } from '@/components/TreeCanvas';
import { DetailPanel } from '@/components/DetailPanel';
import { DataNotice } from '@/components/DataNotice';
import { MiniMap } from '@/components/MiniMap';
import { GenerationRail } from '@/components/GenerationRail';

import '@/styles/base.css';
import '@/styles/liquid-glass.css';
import '@/styles/app.css';
import '@/styles/avatar.css';
import '@/styles/node.css';
import '@/styles/chrome.css';
import '@/styles/detail.css';

/** Largeur réservée au panneau de détails lors d'un recentrage, sur grand écran. */
const PANEL_OFFSET = 400;

export default function App() {
  const { graph, layout, spatial, searchIndex, anomalies } = useFamilyTree(FAMILY_DATASET);
  const [theme, toggleTheme] = useTheme();
  // Une seule source de lumière pour tout le verre de l'interface.
  useGlassLight();
  const compact = useIsCompact();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('close');
  const [flaggedId, setFlaggedId] = useState<string | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [hintVisible, setHintVisible] = useState(true);

  /**
   * Le point de repère.
   *
   * Dans un arbre de cinq cents personnes, « Eugénie Beaumont, 1843 – 1921 »
   * ne dit rien : ce qu'on veut savoir, c'est qui elle est *pour soi*. En
   * désignant une personne comme repère — soi-même, en général — chaque fiche
   * et chaque résultat de recherche se met à répondre à cette question.
   *
   * Le choix est mémorisé : on ne redésigne pas son propre repère à chaque
   * visite.
   */
  const [anchorId, setAnchorId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('arbre-repere');
  });

  useEffect(() => {
    if (anchorId && graph.people.has(anchorId)) {
      window.localStorage.setItem('arbre-repere', anchorId);
    } else {
      window.localStorage.removeItem('arbre-repere');
      if (anchorId) setAnchorId(null);
    }
  }, [anchorId, graph]);

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

  /**
   * Parcourir la famille au clavier.
   *
   * Les flèches seules déplacent la vue — c'est le geste de lecture d'un plan.
   * Avec la touche Option, elles suivent la parenté : vers le haut on remonte
   * à un parent, vers le bas on descend à un enfant, sur les côtés on longe la
   * fratrie. C'est la seule façon de traverser un arbre sans souris, et la plus
   * rapide même avec.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (!selectedId) return;
      const person = graph.people.get(selectedId);
      if (!person) return;

      let next: string | undefined;
      if (event.key === 'ArrowUp') {
        next = person.parents[0];
      } else if (event.key === 'ArrowDown') {
        next = person.children[0];
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const step = event.key === 'ArrowRight' ? 1 : -1;
        // Fratrie d'abord, conjoint à défaut : une personne sans frère ni sœur
        // n'est pas pour autant une impasse.
        const family = [...person.siblings, selectedId].sort(
          (a, b) =>
            (graph.people.get(a)?.birthYear ?? 0) - (graph.people.get(b)?.birthYear ?? 0),
        );
        if (family.length > 1) {
          const index = family.indexOf(selectedId);
          next = family[(index + step + family.length) % family.length];
        } else {
          next = person.spouseLinks[0]?.id;
        }
      } else {
        return;
      }

      if (!next || !graph.people.has(next)) return;
      event.preventDefault();
      selectPerson(next);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [graph, selectedId, selectPerson]);

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

    // L'arbre entier d'abord : on doit voir de quoi il s'agit — un arbre, sa
    // silhouette, son ampleur — avant de descendre dans une branche.
    viewport.set(transformForBounds(layout.bounds, stageSize, FIT_PADDING, 0.92));

    // Puis la vue s'approche doucement du pied, d'où l'on remonte à la molette.
    // Ce mouvement d'ouverture dit en une seconde ce que l'espace contient et
    // comment il se parcourt.
    const { trunk } = layout;
    const main = trunk.roots.reduce(
      (best, root) => (root.weight > best.weight ? root : best),
      trunk.roots[0] ?? { x: trunk.x, y: trunk.baseY, weight: 0 },
    );

    const timer = window.setTimeout(() => {
      viewport.focusPoint(main.x, main.y - ROW_HEIGHT * 0.55, 0.55, 0, 1800);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [viewport, layout]);

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

  // Diagnostic : en développement, le graphe et le placement sont exposés pour
  // pouvoir vérifier depuis l'extérieur que chaque personne affichée est
  // réellement reliée à sa parenté.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__arbre = { graph, layout, viewport };
  }, [graph, layout, viewport]);

  const selectedPerson = selectedId ? (graph.people.get(selectedId) ?? null) : null;

  // Marque les périodes où la vue bouge. La réfraction du verre recalcule tout
  // l'arrière-plan à chaque image ; pendant un déplacement, cet effet est
  // invisible à l'œil mais bien réel pour la machine, donc on le suspend.
  const appRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let timer = 0;
    const unsubscribe = viewport.subscribe(() => {
      const element = appRef.current;
      if (!element) return;
      if (element.dataset.moving !== 'true') element.dataset.moving = 'true';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (appRef.current) appRef.current.dataset.moving = 'false';
      }, 180);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [viewport]);

  return (
    <div className="app" ref={appRef} data-panel-open={selectedPerson ? true : undefined}>
      <GlassFilters />
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
        anchorId={anchorId}
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

      <DataNotice anomalies={anomalies} onSelect={selectPerson} />

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
        anchorId={anchorId}
        onToggleAnchor={() =>
          setAnchorId((current) => (current === selectedId ? null : selectedId))
        }
      />

      <div className="hint-bar lg lg--clear lg--pill" data-hidden={hintVisible ? undefined : true}>
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
        <span className="hint-sep" aria-hidden="true" />
        <span>
          <kbd>⌥</kbd> <kbd>↑↓←→</kbd> suivre la parenté
        </span>
      </div>
    </div>
  );
}
