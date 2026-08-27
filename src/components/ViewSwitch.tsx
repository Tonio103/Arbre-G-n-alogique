import { MapIcon } from './icons';

/**
 * Le passage d'une vue à l'autre.
 *
 * L'arbre reste la vue principale : c'est lui qui décide de qui l'on parle, et
 * les trois autres ne font que le regarder autrement — les mêmes personnes,
 * les mêmes fiches, le même périmètre.
 */
export type ViewMode = 'tree' | 'map' | 'timeline' | 'gaps';

export interface ViewSwitchProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Nombre de manques relevés, affiché en pastille sur « À compléter ». */
  gapCount: number;
}

const TreeGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="19" r="2.4" />
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="18" cy="6" r="2.4" />
    <path d="M12 16.6V12M12 12H6.6M12 12h5.4M6 8.4V12M18 8.4V12" strokeLinecap="round" />
  </svg>
);

const ClockGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.4V12l3.2 2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GapGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M12 4.6 3.4 19.4h17.2L12 4.6Z" strokeLinejoin="round" />
    <path d="M12 10v4.2M12 17.1h.01" strokeLinecap="round" />
  </svg>
);

const TABS: Array<{ mode: ViewMode; label: string; glyph: () => JSX.Element }> = [
  { mode: 'tree', label: 'Arbre', glyph: TreeGlyph },
  { mode: 'map', label: 'Carte', glyph: MapIcon as () => JSX.Element },
  { mode: 'timeline', label: 'Chronologie', glyph: ClockGlyph },
  { mode: 'gaps', label: 'À compléter', glyph: GapGlyph },
];

export function ViewSwitch({ mode, onChange, gapCount }: ViewSwitchProps) {
  return (
    <nav className="view-switch lg lg--chip" aria-label="Vue">
      {TABS.map((tab) => {
        const Glyph = tab.glyph;
        const active = tab.mode === mode;
        return (
          <button
            key={tab.mode}
            type="button"
            className="view-switch-tab"
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(tab.mode)}
          >
            <Glyph />
            <span>{tab.label}</span>
            {tab.mode === 'gaps' && gapCount > 0 && (
              <em className="view-switch-count">{gapCount}</em>
            )}
          </button>
        );
      })}
    </nav>
  );
}
