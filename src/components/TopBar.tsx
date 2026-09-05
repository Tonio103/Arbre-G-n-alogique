import type { ReactNode } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { SearchIndex } from '@/domain/search';
import type { HighlightMode } from '@/domain/relations';
import { SearchField } from './SearchField';
import { ViewSwitch, type ViewMode } from './ViewSwitch';
import { BranchIcon, FitIcon, HelpIcon, MinusIcon, MoonIcon, PlusIcon, SunIcon } from './icons';

export interface TopBarProps {
  graph: FamilyGraph;
  searchIndex: SearchIndex;
  onPick: (id: string) => void;
  /** Personne de référence, transmise à la recherche. */
  anchorId: string | null;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  highlightMode: HighlightMode;
  onToggleHighlightMode: () => void;
  theme: 'dark' | 'light';
  /** Coordonnées de l'écran d'où fait rayonner la transition de thème. */
  onToggleTheme: (x: number, y: number) => void;
  /** Rouvre le guide de navigation. */
  onOpenTour: () => void;
  /** La bascule entre l'arbre et ses trois autres lectures — voir `ViewSwitch`. */
  viewMode: ViewMode;
  onChangeView: (mode: ViewMode) => void;
  /** Nombre de manques relevés, reporté en pastille sur l'onglet « À compléter ». */
  gapCount: number;
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  className?: string;
}

export function IconButton({ label, onClick, children, pressed, className }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${className ?? ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      data-pressed={pressed || undefined}
    >
      {children}
    </button>
  );
}

export function TopBar({
  graph,
  searchIndex,
  onPick,
  anchorId,
  onFit,
  onZoomIn,
  onZoomOut,
  highlightMode,
  onToggleHighlightMode,
  theme,
  onToggleTheme,
  onOpenTour,
  viewMode,
  onChangeView,
  gapCount,
}: TopBarProps) {
  return (
    <header className="topbar lg lg--thick lg--bar">
      <div className="topbar-identity">
        {/*
          La marque : un cachet d'ex-libris plutôt qu'une icône d'application.
          L'initiale sort du titre de l'arbre — c'est la famille qui signe sa
          planche, pas le logiciel qui signe sa fenêtre.
        */}
        <span className="topbar-mark" aria-hidden="true">
          {(graph.title || 'A').trim().charAt(0).toUpperCase()}
        </span>
        <span className="topbar-titles">
          <h1 className="topbar-title">{graph.title}</h1>
          <span className="topbar-subtitle">
            {graph.people.size} personnes · {graph.generations.length} générations
          </span>
        </span>
      </div>

      <div className="topbar-search">
        <SearchField
          graph={graph}
          index={searchIndex}
          onPick={onPick}
          total={graph.people.size}
          anchorId={anchorId}
        />
        {/* Les quatre lectures de l'arbre vivaient dans une pilule flottante
            au bas de l'écran, coupée de tout ce qui règle la vue au-dessus
            d'elle. Elles rejoignent la recherche : changer de lecture est un
            geste de la même famille que chercher quelqu'un, pas un geste à
            part. */}
        <ViewSwitch mode={viewMode} onChange={onChangeView} gapCount={gapCount} />
      </div>

      <div className="topbar-controls">
        <div className="control-group lg lg--control lg--bar">
          <IconButton label="Voir l’arbre entier" onClick={onFit}>
            <FitIcon />
          </IconButton>
          <IconButton label="Dézoomer" onClick={onZoomOut}>
            <MinusIcon />
          </IconButton>
          <IconButton label="Zoomer" onClick={onZoomIn}>
            <PlusIcon />
          </IconButton>
        </div>

        <div className="control-group lg lg--control lg--bar">
          <IconButton
            className="hide-compact"
            label={
              highlightMode === 'lineage'
                ? 'Mise en évidence : lignée entière'
                : 'Mise en évidence : famille proche'
            }
            onClick={onToggleHighlightMode}
            pressed={highlightMode === 'lineage'}
          >
            <BranchIcon />
          </IconButton>
          <button
            type="button"
            className="icon-button"
            title={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
            aria-label={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
            onClick={(event) => onToggleTheme(event.clientX, event.clientY)}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <IconButton label="Comment lire l’arbre" onClick={onOpenTour}>
            <HelpIcon />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
