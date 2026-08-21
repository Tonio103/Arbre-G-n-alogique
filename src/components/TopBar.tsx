import type { ReactNode } from 'react';
import type { FamilyGraph } from '@/domain/graph';
import type { SearchIndex } from '@/domain/search';
import type { HighlightMode } from '@/domain/relations';
import { SearchField } from './SearchField';
import {
  BranchIcon,
  FitIcon,
  HomeIcon,
  MapIcon,
  MinusIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
} from './icons';

export interface TopBarProps {
  graph: FamilyGraph;
  searchIndex: SearchIndex;
  onPick: (id: string) => void;
  /** Personne de référence, transmise à la recherche. */
  anchorId: string | null;
  onHome: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  highlightMode: HighlightMode;
  onToggleHighlightMode: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
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
  onHome,
  onFit,
  onZoomIn,
  onZoomOut,
  highlightMode,
  onToggleHighlightMode,
  theme,
  onToggleTheme,
  showMiniMap,
  onToggleMiniMap,
}: TopBarProps) {
  return (
    <header className="topbar lg lg--thick">
      <div className="topbar-identity">
        <span className="topbar-mark" aria-hidden="true" />
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
      </div>

      <div className="topbar-controls">
        <div className="control-group lg lg--control">
          <IconButton label="Revenir à la personne principale" onClick={onHome}>
            <HomeIcon />
          </IconButton>
          <IconButton label="Voir l’arbre entier" onClick={onFit}>
            <FitIcon />
          </IconButton>
        </div>

        <div className="control-group lg lg--control">
          <IconButton label="Dézoomer" onClick={onZoomOut}>
            <MinusIcon />
          </IconButton>
          <IconButton label="Zoomer" onClick={onZoomIn}>
            <PlusIcon />
          </IconButton>
        </div>

        <div className="control-group lg lg--control">
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
          <IconButton
            className="hide-compact"
            label={showMiniMap ? 'Masquer la vue d’ensemble' : 'Afficher la vue d’ensemble'}
            onClick={onToggleMiniMap}
            pressed={showMiniMap}
          >
            <MapIcon />
          </IconButton>
          <IconButton
            label={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </IconButton>
        </div>
      </div>
    </header>
  );
}
