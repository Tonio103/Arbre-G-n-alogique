import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useFamilyTree } from '@/hooks/useFamilyTree';
import { unionKey } from '@/domain/graph';
import { useDataset } from '@/hooks/useDataset';
import { useTheme } from '@/hooks/useTheme';
import { useGlassLight } from '@/hooks/useGlassLight';
import { useIsCompact } from '@/hooks/useMediaQuery';
import { computeHighlight, relationPath, type HighlightMode } from '@/domain/relations';
import {
  addChild,
  addParent,
  addSpouse,
  createPerson,
  deletePerson,
  linkChild,
  linkParent,
  linkSpouse,
  upsertPerson,
  type NewPersonInput,
} from '@/domain/edit';
import type { PersonRecord, UnionStatus } from '@/data/schema';
import { ViewportController, transformForBounds } from '@/view/viewport';
import { HoverStore } from '@/view/hover-store';
import { CARD_HEIGHT, CARD_WIDTH, FIT_PADDING } from '@/view/metrics';
import { Backdrop } from '@/components/Backdrop';
import { LoadingScreen } from '@/components/LoadingScreen';
import { GlassFilters } from '@/components/GlassFilters';
import { BranchLabels } from '@/components/BranchLabels';
import { TopBar } from '@/components/TopBar';
import { TreeCanvas } from '@/components/TreeCanvas';
import { DetailPanel } from '@/components/DetailPanel';
import { DataNotice } from '@/components/DataNotice';
import { DataPanel } from '@/components/DataPanel';
import { MiniMap } from '@/components/MiniMap';
import { FamilyMap } from '@/components/FamilyMap';
import { GenerationRail } from '@/components/GenerationRail';

import '@/styles/base.css';
import '@/styles/liquid-glass.css';
import '@/styles/app.css';
import '@/styles/avatar.css';
import '@/styles/node.css';
import '@/styles/chrome.css';
import '@/styles/detail.css';
import '@/styles/family-map.css';
import '@/styles/data-panel.css';
import '@/styles/loading-screen.css';
import '@/styles/path-flow.css';
import '@/styles/theme-transition.css';

/** Largeur réservée au panneau de détails lors d'un recentrage, sur grand écran. */
const PANEL_OFFSET = 400;

export default function App() {
  const datasetCtrl = useDataset();
  const { graph, layout, spatial, searchIndex, anomalies } = useFamilyTree(datasetCtrl.dataset);
  const [theme, toggleTheme] = useTheme();

  /**
   * Bascule de thème, en iris.
   *
   * `startViewTransition` fige l'écran, laisse `toggleTheme` changer l'état,
   * puis anime la différence — c'est cette capture qui permet à
   * `theme-transition.css` de balayer un thème par l'autre depuis le point du
   * geste plutôt que d'un bord de l'écran. L'API n'existe pas partout, et un
   * mouvement réduit demandé doit rester sans effet visuel : dans les deux
   * cas, on se contente de la bascule instantanée déjà en place.
   */
  const toggleThemeFromPoint = useCallback(
    (x: number, y: number) => {
      const doc = document as Document & {
        startViewTransition?: (callback: () => void) => {
          ready: Promise<void>;
          finished: Promise<void>;
          updateCallbackDone: Promise<void>;
        };
      };
      if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        toggleTheme();
        return;
      }
      document.documentElement.style.setProperty('--reveal-x', `${x}px`);
      document.documentElement.style.setProperty('--reveal-y', `${y}px`);
      // `startViewTransition` fige l'écran au moment où le callback rend la
      // main : un `setState` React ordinaire ne peint qu'au prochain cycle,
      // trop tard pour la capture. `flushSync` force la mise à jour du DOM
      // avant que le callback ne se termine.
      const transition = doc.startViewTransition(() => {
        flushSync(() => {
          toggleTheme();
        });
      });
      // Le navigateur peut interrompre une transition (geste répété trop
      // vite, onglet masqué) : une promesse rejetée sans anse remonterait en
      // erreur non interceptée alors que la bascule, elle, a déjà eu lieu.
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
      transition.updateCallbackDone.catch(() => {});
    },
    [toggleTheme],
  );
  // Une seule source de lumière pour tout le verre de l'interface.
  useGlassLight();
  const compact = useIsCompact();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('close');
  const [flaggedId, setFlaggedId] = useState<string | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [showDataPanel, setShowDataPanel] = useState(false);
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
  // Une seule instance pour toute la session — pas une par changement de
  // bornes. Un import ou une retouche recalcule `layout.bounds` à chaque
  // fois ; recréer le contrôleur à chaque fois jetterait le cadrage en
  // cours, comme si retoucher une seule fiche remettait la vue à zéro.
  const viewport = useMemo(() => new ViewportController({ bounds: layout.bounds }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    viewport.setBounds(layout.bounds);
  }, [viewport, layout.bounds]);

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
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (introRef.current) return;
    // Tant que la version partagée n'a pas répondu, l'arbre affiché n'est
    // qu'un brouillon local — inutile de cadrer dessus pour devoir recadrer
    // une seconde fois dès que la vraie version arrive.
    if (datasetCtrl.loading) return;
    const stageSize = viewport.size;
    if (stageSize.width <= 1) return;
    introRef.current = true;
    // Le rideau de chargement se retire ici : c'est le premier instant où
    // l'arbre est réellement cadré, pas un délai arbitraire.
    setReady(true);

    // L'arbre entier d'abord : on doit voir de quoi il s'agit — un arbre, sa
    // silhouette, son ampleur — avant de descendre dans une branche.
    viewport.set(transformForBounds(layout.bounds, stageSize, FIT_PADDING, 0.92));

    // Puis la vue s'approche doucement du pied, d'où l'on plonge à la molette
    // ou en glissant. Ce mouvement d'ouverture dit en une seconde ce que
    // l'espace contient et comment il se parcourt.
    // Puis la vue s'approche doucement de la personne principale.
    const root = layout.positions.get(graph.rootId);

    const timer = window.setTimeout(() => {
      if (root) viewport.focusPoint(root.x + CARD_WIDTH / 2, root.y + CARD_HEIGHT / 2, 0.9, 0, 1800);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [viewport, layout, datasetCtrl.loading]);

  /*
   * Un import ou un retour à la démonstration change l'arbre de forme au
   * point que l'ancien cadrage n'a plus de sens — contrairement à une simple
   * retouche de fiche, qui ne doit surtout pas faire sauter la caméra.
   * `replaceVersion` ne bouge que pour ce cas-là ; sa première valeur
   * correspond au chargement initial, déjà traité par l'ouverture ci-dessus.
   */
  const replaceVersionRef = useRef(datasetCtrl.replaceVersion);
  useEffect(() => {
    if (datasetCtrl.replaceVersion === replaceVersionRef.current) return;
    replaceVersionRef.current = datasetCtrl.replaceVersion;
    setSelectedId(null);
    setFlaggedId(null);
    setHighlightMode('close');
    viewport.fit(layout.bounds, FIT_PADDING, 0.92, 720);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetCtrl.replaceVersion]);

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

  /*
   * Le chemin de parenté entre le repère et la personne ouverte.
   *
   * Il ne se calcule que lorsque les deux existent et diffèrent — c'est-à-dire
   * quand la question « comment suis-je lié à cette personne ? » a un sens.
   */
  const relation = useMemo(
    () =>
      anchorId && selectedId && anchorId !== selectedId
        ? relationPath(graph, anchorId, selectedId)
        : undefined,
    [graph, anchorId, selectedId],
  );

  /*
   * Retouches.
   *
   * Chacune passe par `datasetCtrl.mutate`, qui persiste dans le navigateur
   * et laisse `useFamilyTree` reconstruire graphe, placement et index à
   * partir de la nouvelle liste — la même mécanique qu'un import, à
   * l'échelle d'une seule personne.
   */
  const updatePerson = useCallback(
    (record: PersonRecord) => {
      datasetCtrl.mutate((people) => upsertPerson(people, record));
    },
    [datasetCtrl],
  );

  const removePerson = useCallback(
    (id: string) => {
      datasetCtrl.mutate((people) => deletePerson(people, id));
      setSelectedId((current) => (current === id ? null : current));
      setFlaggedId((current) => (current === id ? null : current));
    },
    [datasetCtrl],
  );

  /*
   * L'union qu'on vient de créer.
   *
   * Son identifiant se prédit sans attendre la reconstruction du graphe (voir
   * `unionKey`) : on le connaît dès qu'on sait qui la compose, au moment même
   * de l'ajout. `LinkLayer` s'en sert pour dessiner ce trait au lieu de le
   * faire apparaître d'un coup — voir l'écran de chargement pour la même
   * idée, appliquée cette fois à une seule branche plutôt qu'à l'arbre entier.
   */
  const [growingUnionId, setGrowingUnionId] = useState<string | null>(null);
  const growingTimerRef = useRef(0);
  const growUnion = useCallback((id: string) => {
    window.clearTimeout(growingTimerRef.current);
    setGrowingUnionId(id);
    growingTimerRef.current = window.setTimeout(() => setGrowingUnionId(null), 900);
  }, []);
  useEffect(() => () => window.clearTimeout(growingTimerRef.current), []);

  const addPersonParent = useCallback(
    (childId: string, input: NewPersonInput) => {
      const existingIds = new Set(graph.people.keys());
      const parent = createPerson(input, existingIds);
      const nextParents = [...(graph.people.get(childId)?.parents ?? []), parent.id].slice(0, 2);
      datasetCtrl.mutate((people) => addParent(people, childId, parent));
      growUnion(nextParents.length > 1 ? unionKey(nextParents[0], nextParents[1]) : unionKey(nextParents[0]));
    },
    [datasetCtrl, graph, growUnion],
  );

  const addPersonSpouse = useCallback(
    (personId: string, input: NewPersonInput, union?: { status: UnionStatus; since?: string; place?: string }) => {
      const existingIds = new Set(graph.people.keys());
      const spouse = createPerson(input, existingIds);
      datasetCtrl.mutate((people) => addSpouse(people, personId, spouse, union));
      growUnion(unionKey(personId, spouse.id));
    },
    [datasetCtrl, graph, growUnion],
  );

  const addPersonChild = useCallback(
    (parentId: string, input: NewPersonInput, otherParentId: string | null) => {
      const existingIds = new Set(graph.people.keys());
      const child = createPerson(input, existingIds);
      const parentIds = otherParentId ? [parentId, otherParentId] : [parentId];
      datasetCtrl.mutate((people) => addChild(people, parentIds, child));
      growUnion(otherParentId ? unionKey(parentId, otherParentId) : unionKey(parentId));
    },
    [datasetCtrl, graph, growUnion],
  );

  const linkPersonParent = useCallback(
    (childId: string, parentId: string) => {
      const nextParents = [...(graph.people.get(childId)?.parents ?? []), parentId].slice(0, 2);
      datasetCtrl.mutate((people) => linkParent(people, childId, parentId));
      growUnion(nextParents.length > 1 ? unionKey(nextParents[0], nextParents[1]) : unionKey(nextParents[0]));
    },
    [datasetCtrl, graph, growUnion],
  );

  const linkPersonSpouse = useCallback(
    (personId: string, spouseId: string, union?: { status: UnionStatus; since?: string; place?: string }) => {
      datasetCtrl.mutate((people) => linkSpouse(people, personId, spouseId, union));
      growUnion(unionKey(personId, spouseId));
    },
    [datasetCtrl, growUnion],
  );

  const linkPersonChild = useCallback(
    (parentId: string, childId: string, otherParentId: string | null) => {
      const parentIds = otherParentId ? [parentId, otherParentId] : [parentId];
      datasetCtrl.mutate((people) => linkChild(people, parentIds, childId));
      growUnion(otherParentId ? unionKey(parentId, otherParentId) : unionKey(parentId));
    },
    [datasetCtrl, growUnion],
  );

  // Diagnostic : en développement, le graphe et le placement sont exposés pour
  // pouvoir vérifier depuis l'extérieur que chaque personne affichée est
  // réellement reliée à sa parenté.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__arbre = { graph, layout, viewport };
  }, [graph, layout, viewport]);

  const selectedPerson = selectedId ? (graph.people.get(selectedId) ?? null) : null;

  /*
   * Le verre gardait autrefois une marque `data-moving` pendant les gestes,
   * qui suspendait son flou et sa réfraction le temps du déplacement (voir
   * `liquid-glass.css`). La bascule se voyait à chaque zoom et à chaque
   * glissé : la netteté constante vaut mieux ici que les images gagnées, et
   * plus rien ne lit cette marque.
   */
  return (
    <div className="app" data-panel-open={selectedPerson ? true : undefined}>
      <LoadingScreen ready={ready} />
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
        pathPeople={relation?.people}
        pathUnions={relation?.unions}
        relation={relation}
        growingUnionId={growingUnionId}
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
        onToggleTheme={toggleThemeFromPoint}
        showMiniMap={showMiniMap}
        onToggleMiniMap={() => setShowMiniMap((value) => !value)}
        onOpenData={() => setShowDataPanel(true)}
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

      {!compact && <FamilyMap graph={graph} onSelectPlace={pickFromSearch} />}

      <DetailPanel
        relation={relation}
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
        onUpdatePerson={updatePerson}
        onDeletePerson={removePerson}
        onAddParent={(input) => selectedId && addPersonParent(selectedId, input)}
        onAddSpouse={(input, union) => selectedId && addPersonSpouse(selectedId, input, union)}
        onAddChild={(input, otherParentId) => selectedId && addPersonChild(selectedId, input, otherParentId)}
        onLinkParent={(parentId) => selectedId && linkPersonParent(selectedId, parentId)}
        onLinkSpouse={(spouseId, union) => selectedId && linkPersonSpouse(selectedId, spouseId, union)}
        onLinkChild={(childId, otherParentId) => selectedId && linkPersonChild(selectedId, childId, otherParentId)}
      />

      <div className="hint-bar lg lg--clear lg--pill" data-hidden={hintVisible ? undefined : true}>
        <span>
          <kbd>Molette</kbd> zoom
        </span>
        <span className="hint-sep" aria-hidden="true" />
        <span>
          <kbd>Glisser</kbd> déplacer
        </span>
      </div>

      {showDataPanel && (
        <DataPanel
          graph={graph}
          dataset={datasetCtrl.dataset}
          source={datasetCtrl.source}
          onImport={(imported) => datasetCtrl.replace(imported, 'import')}
          onReset={datasetCtrl.reset}
          onClose={() => setShowDataPanel(false)}
        />
      )}
    </div>
  );
}
